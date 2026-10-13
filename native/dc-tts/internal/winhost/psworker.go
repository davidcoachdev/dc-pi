package winhost

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"

	"github.com/dc-studio/dc-tts/internal/protocol"
)

// psWorkerScript runs inside a single persistent PowerShell worker process.
// It blocks on [Console]::In.ReadLine() (0.0% CPU when idle) and executes
// SAPI SpeechSynthesizer (SpeakAsync + Queue) and WinRT SpeechRecognizer (es-MX/en-US).
const psWorkerScript = `
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SetOutputToDefaultAudioDevice()

# Prefer Spanish voices (Sabina es-MX or Helena es-ES) by default if installed
$installedVoices = $synth.GetInstalledVoices() | Where-Object { $_.Enabled }
$preferred = $installedVoices | Where-Object { $_.VoiceInfo.Name -like "*Sabina*" -or $_.VoiceInfo.Name -like "*Helena*" } | Select-Object -First 1
if ($preferred) {
  try { $synth.SelectVoice($preferred.VoiceInfo.Name) } catch {}
}

$state = [hashtable]::Synchronized(@{
  status     = "idle"
  autoRead   = $true
  voice      = $synth.Voice.Name
  rate       = 1.0
  volume     = 100
  lastPrompt = $null
  queue      = (New-Object System.Collections.Queue)
})

function Apply-SynthSettings {
  $intRate = [int][Math]::Round(($state.rate - 1.0) * 10.0, [System.MidpointRounding]::AwayFromZero)
  if ($intRate -lt -10) { $intRate = -10 }
  if ($intRate -gt 10)  { $intRate = 10 }
  $synth.Rate   = $intRate
  $synth.Volume = [int]$state.volume
}
Apply-SynthSettings

function Sync-SynthState {
  $st = $synth.State.ToString()
  $hasPending = ($null -ne $state.lastPrompt -and (-not $state.lastPrompt.IsCompleted))
  if ($st -eq "Paused") {
    $state.status = "paused"
  } elseif ($st -eq "Speaking" -or $hasPending) {
    $state.status = "playing"
  } else {
    $state.status = "idle"
  }
}

function Get-StatusJson {
  Sync-SynthState
  return (@{
    status     = $state.status
    queue      = 0
    autoRead   = $state.autoRead
    voice      = $state.voice
    rate       = $state.rate
    volume     = $state.volume
    listenMode = "off"
    wakeWord   = "dc"
    language   = "es-MX"
  } | ConvertTo-Json -Compress)
}

function Wait-UntilSpeechIdle([int]$maxWaitMs = 20000) {
  $elapsed = 0
  while ($synth.State.ToString() -eq "Speaking" -and $elapsed -lt $maxWaitMs) {
    Start-Sleep -Milliseconds 80
    $elapsed += 80
  }
  Start-Sleep -Milliseconds 150
  Sync-SynthState
}

function Invoke-OfflineSapiTranscribe([int]$timeoutSec) {
  $r = New-Object System.Speech.Recognition.SpeechRecognitionEngine
  try {
    $r.SetInputToDefaultAudioDevice()
    $sec = [Math]::Max(2, $timeoutSec)
    $r.InitialSilenceTimeout = [TimeSpan]::FromSeconds($sec)
    $r.BabbleTimeout = [TimeSpan]::FromSeconds($sec)
    $r.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(600)
    $g = New-Object System.Speech.Recognition.DictationGrammar
    $r.LoadGrammar($g)
    $res = $r.Recognize([TimeSpan]::FromSeconds($sec))
    if ($null -eq $res -or [double]$res.Confidence -lt 0.25) {
      return (@{ text = ""; confidence = 0.0 } | ConvertTo-Json -Compress)
    }
    return (@{ text = [string]$res.Text; confidence = [double]$res.Confidence } | ConvertTo-Json -Compress)
  } finally {
    $r.Dispose()
  }
}

function Invoke-WinRTTranscribe([string]$langTag, [int]$timeoutSec) {
  try {
    $null = [Windows.Media.SpeechRecognition.SpeechRecognizer, Windows.Media.SpeechRecognition, ContentType=WindowsRuntime]
    $null = [Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime]
    Add-Type -AssemblyName System.Runtime.WindowsRuntime

    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*'
    })[0]

    function Await-WinRT($op, [Type]$resultType) {
      $m = $asTaskGeneric.MakeGenericMethod($resultType)
      $task = $m.Invoke($null, @($op))
      $task.Wait() | Out-Null
      return $task.Result
    }

    $lang = New-Object Windows.Globalization.Language($langTag)
    $rec = New-Object Windows.Media.SpeechRecognition.SpeechRecognizer($lang)
    $rec.Timeouts.InitialSilenceTimeout = [TimeSpan]::FromSeconds([Math]::Max(2, $timeoutSec))
    $rec.Timeouts.BabbleTimeout = [TimeSpan]::FromSeconds([Math]::Max(2, $timeoutSec))
    $rec.Timeouts.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(600)

    $compileRes = Await-WinRT ($rec.CompileConstraintsAsync()) ([Windows.Media.SpeechRecognition.SpeechRecognitionCompilationResult])
    $res = Await-WinRT ($rec.RecognizeAsync()) ([Windows.Media.SpeechRecognition.SpeechRecognitionResult])
    $text = [string]$res.Text
    $conf = [double]$res.RawConfidence
    $rec.Dispose()
    return (@{ text = $text; confidence = $conf } | ConvertTo-Json -Compress)
  } catch {
    try {
      return (Invoke-OfflineSapiTranscribe $timeoutSec)
    } catch {
      return (@{ error = $_.Exception.Message } | ConvertTo-Json -Compress)
    }
  }
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $cmd = $line.Trim()
  if ($cmd -eq "") { continue }

  try {
    if ($cmd -eq "status" -or $cmd -eq "wsl-bridge-handshake") {
      [Console]::Out.WriteLine((Get-StatusJson))
      continue
    }
    if ($cmd -eq "voices") {
      $vlist = @()
      foreach ($v in ($synth.GetInstalledVoices() | Where-Object { $_.Enabled })) {
        $vlist += @{
          name    = $v.VoiceInfo.Name
          culture = $v.VoiceInfo.Culture.Name
          gender  = $v.VoiceInfo.Gender.ToString()
        }
      }
      [Console]::Out.WriteLine((@{ voices = $vlist } | ConvertTo-Json -Compress -Depth 4))
      continue
    }
    if ($cmd.StartsWith("speak64:")) {
      $b64 = $cmd.Substring(8)
      $text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($b64))
      if ($synth.State.ToString() -eq "Paused") {
        $synth.Resume()
      }
      $state.lastPrompt = $synth.SpeakAsync($text)
      $state.status = "playing"
      [Console]::Out.WriteLine((Get-StatusJson))
      continue
    }
    if ($cmd -eq "pause") {
      if ($synth.State.ToString() -eq "Speaking") {
        $synth.Pause()
      }
      [Console]::Out.WriteLine((Get-StatusJson))
      continue
    }
    if ($cmd -eq "resume") {
      if ($synth.State.ToString() -eq "Paused") {
        $synth.Resume()
      }
      [Console]::Out.WriteLine((Get-StatusJson))
      continue
    }
    if ($cmd -eq "stop") {
      $state.lastPrompt = $null
      if ($synth.State.ToString() -eq "Paused") {
        $synth.Resume()
      }
      $synth.SpeakAsyncCancelAll()
      [Console]::Out.WriteLine((Get-StatusJson))
      continue
    }
    if ($cmd -eq "toggle") {
      if ($synth.State.ToString() -eq "Speaking") {
        $synth.Pause()
      } elseif ($synth.State.ToString() -eq "Paused") {
        $synth.Resume()
      }
      [Console]::Out.WriteLine((Get-StatusJson))
      continue
    }
    if ($cmd -eq "autoread") {
      $state.autoRead = -not [bool]$state.autoRead
      if (-not $state.autoRead) {
        $state.lastPrompt = $null
        if ($synth.State.ToString() -eq "Paused") { $synth.Resume() }
        $synth.SpeakAsyncCancelAll()
      }
      [Console]::Out.WriteLine((Get-StatusJson))
      continue
    }
    if ($cmd.StartsWith("voice ")) {
      $vname = $cmd.Substring(6).Trim()
      $synth.SelectVoice($vname)
      $state.voice = $synth.Voice.Name
      [Console]::Out.WriteLine((Get-StatusJson))
      continue
    }
    if ($cmd.StartsWith("rate ")) {
      $rval = [double]::Parse($cmd.Substring(5).Trim(), [System.Globalization.CultureInfo]::InvariantCulture)
      if ($rval -lt 0.25) { $rval = 0.25 }
      if ($rval -gt 2.0)  { $rval = 2.0 }
      $state.rate = $rval
      Apply-SynthSettings
      [Console]::Out.WriteLine((Get-StatusJson))
      continue
    }
    if ($cmd.StartsWith("volume ")) {
      $vval = [int]::Parse($cmd.Substring(7).Trim())
      if ($vval -lt 0)   { $vval = 0 }
      if ($vval -gt 100) { $vval = 100 }
      $state.volume = $vval
      Apply-SynthSettings
      [Console]::Out.WriteLine((Get-StatusJson))
      continue
    }
    if ($cmd.StartsWith("beep:")) {
      $kind = $cmd.Substring(5).Trim().ToLower()
      switch ($kind) {
        "alert"  { [System.Media.SystemSounds]::Exclamation.Play() }
        "result" { [System.Media.SystemSounds]::Asterisk.Play() }
        "error"  { [System.Media.SystemSounds]::Hand.Play() }
        default  { [System.Media.SystemSounds]::Question.Play() }
      }
      [Console]::Out.WriteLine((Get-StatusJson))
      continue
    }
    if ($cmd.StartsWith("stt:")) {
      Wait-UntilSpeechIdle 20000
      $parts = $cmd.Substring(4).Split("|")
      $lang = if ($parts.Length -ge 1 -and $parts[0] -ne "") { $parts[0] } else { "es-MX" }
      $tsec = if ($parts.Length -ge 2) { [int]$parts[1] } else { 8 }
      [Console]::Out.WriteLine((Invoke-WinRTTranscribe $lang $tsec))
      continue
    }

    [Console]::Out.WriteLine((Get-StatusJson))
  } catch {
    [Console]::Out.WriteLine((@{ status = $state.status; error = $_.Exception.Message } | ConvertTo-Json -Compress))
  }
}
`

// PowerShellEngine implements Engine using a single persistent Windows PowerShell co-process.
type PowerShellEngine struct {
	mu     sync.Mutex
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout *bufio.Reader
}

// ResolvePowerShellBinary finds powershell.exe across Windows and WSL2 (even with appendWindowsPath=false).
func ResolvePowerShellBinary(explicit string) string {
	if strings.TrimSpace(explicit) != "" {
		return strings.TrimSpace(explicit)
	}
	const wslPS = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
	if _, err := exec.LookPath(wslPS); err == nil {
		return wslPS
	}
	return "powershell.exe"
}

// NewPowerShellEngine starts the persistent Windows SAPI + WinRT co-process.
func NewPowerShellEngine(psBinary string) (*PowerShellEngine, error) {
	psBinary = ResolvePowerShellBinary(psBinary)

	cmd := exec.Command(psBinary, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", psWorkerScript)
	configureHiddenProcess(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("winhost: failed to start powershell worker (%s): %w", psBinary, err)
	}

	eng := &PowerShellEngine{
		cmd:    cmd,
		stdin:  stdin,
		stdout: bufio.NewReader(stdoutPipe),
	}
	return eng, nil
}

func (p *PowerShellEngine) request(line string) ([]byte, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if _, err := fmt.Fprintln(p.stdin, line); err != nil {
		return nil, err
	}
	resp, err := p.stdout.ReadBytes('\n')
	if err != nil {
		return nil, err
	}
	return []byte(strings.TrimSpace(string(resp))), nil
}

// Command executes a TTS control command.
func (p *PowerShellEngine) Command(cmd string) (protocol.StatusResponse, error) {
	wireCmd := cmd
	if strings.HasPrefix(cmd, "speak:") {
		text := cmd[6:]
		b64 := base64.StdEncoding.EncodeToString([]byte(text))
		wireCmd = "speak64:" + b64
	}

	raw, err := p.request(wireCmd)
	if err != nil {
		return protocol.StatusResponse{}, err
	}
	var st protocol.StatusResponse
	if err := json.Unmarshal(raw, &st); err != nil {
		return protocol.StatusResponse{}, fmt.Errorf("winhost: invalid worker JSON %q: %w", raw, err)
	}
	if st.Error != "" {
		return st, fmt.Errorf("%s", st.Error)
	}
	return st, nil
}

// Voices queries installed Windows SAPI voices.
func (p *PowerShellEngine) Voices() ([]protocol.VoiceInfo, error) {
	raw, err := p.request("voices")
	if err != nil {
		return nil, err
	}
	var vr protocol.VoicesResponse
	if err := json.Unmarshal(raw, &vr); err != nil {
		return nil, fmt.Errorf("winhost: invalid voices JSON %q: %w", raw, err)
	}
	return vr.Voices, nil
}

// TranscribeOnce captures one spoken utterance using Windows WinRT SpeechRecognizer.
func (p *PowerShellEngine) TranscribeOnce(req protocol.TranscriptionCommand) (string, float64, error) {
	lang := req.Language
	if lang == "" {
		lang = "es-MX"
	}
	timeout := req.TimeoutS
	if timeout <= 0 {
		timeout = 8
	}
	raw, err := p.request(fmt.Sprintf("stt:%s|%d", lang, timeout))
	if err != nil {
		return "", 0, err
	}
	var res struct {
		Text       string  `json:"text"`
		Confidence float64 `json:"confidence"`
		Error      string  `json:"error"`
	}
	if err := json.Unmarshal(raw, &res); err != nil {
		return "", 0, fmt.Errorf("winhost: invalid stt JSON %q: %w", raw, err)
	}
	if res.Error != "" {
		return "", 0, fmt.Errorf("%s", res.Error)
	}
	return res.Text, res.Confidence, nil
}

// Close terminates the persistent worker process.
func (p *PowerShellEngine) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	_ = p.stdin.Close()
	if p.cmd != nil && p.cmd.Process != nil {
		_ = p.cmd.Process.Kill()
	}
	return nil
}
