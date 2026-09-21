/**
 * dc-face — carita dc-dev segun estado del agente.
 *
 * Sidebar visible (fullscreen >= 140 cols): carita GRANDE abajo del todo del
 * rail, registrada como seccion "face" en el estado compartido del sidebar
 * de gentle-pi (Symbol.for("gentle-pi.experimental-sidebar.state")).
 * Requiere el parche de gentle-pi que agrega "face" a las secciones del rail.
 *
 * Sidebar contraido (angosto o modo regular): mini-carita de UNA LINEA en la
 * barra inferior (status de extension, grupo Integrations cuando hay rail).
 *
 * Mapeo de estados del agente Pi (refactor del plugin OpenCode dc-faces):
 * - agent_start / turn_start / message_start(assistant) -> pensando
 * - message_update (streaming) -> escribiendo
 * - tool_execution_start/end -> trabajando (end con error -> reintentando)
 * - session_before_compact / session_compact(_failed) -> compactando
 * - agent_settled -> feliz (habla optimista si hay bridge TTS, dormido a los 20s)
 * - ui_prompt_start/end (confirm -> permiso, resto -> pregunta)
 * - TTS por bridge http://127.0.0.1:9877: opcional, auto-disable si no hay.
 *
 * Comandos: /face (estado), /face hide, /face show, /face cubis, /face dcdev
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";

type Mode =
  | "feliz"
  | "pensando"
  | "escribiendo"
  | "trabajando"
  | "dormido"
  | "compactando"
  | "reintentando"
  | "hablando"
  | "permiso"
  | "pregunta";

const BRIDGE_URL = "http://127.0.0.1:9877" as const;
const ANIM_MS = 900;
const IDLE_TO_SLEEP_MS = 20000;
const TTS_GRACE_MS = 2500;
const RETRY_FLASH_MS = 2500;
// Por debajo de esta altura de terminal, la carota grande no entra en el sidebar
// → se cambia a la mini-carita de 1 línea (responsive al alto).
const BIG_FACE_MIN_ROWS = 46;

function isSidebarHidden(): boolean {
  try {
    const p = path.join(os.homedir(), ".pi/agent/dc-sidebar.json");
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      return j.hidden === true;
    }
  } catch {
    /* noop */
  }
  return false;
}

// ── Mini-caras de una linea (sidebar contraido / barra inferior) ──
const FACES: Record<Mode, string[]> = {
  feliz: [
    "≧(❂‿❂)≦  "
  ],
  pensando: [
    " ( ≖.≖ )   ",
    " (  ≖.≖)   ",
    " ( ≖.≖ )   ",
    " (≖.≖  )   "
  ],
  escribiendo: [
    "m( ◔◡◔ )m   ",
    "m(◔◡◔҂ )m   ",
    "m( ◔◡◔ )m   ",
    "m( ͠҂◔◡◔)m   "
  ],
  trabajando: [
    "^( '-' )^   ",
    "<( '-'<)    ",
    "^( '-' )^   ",
    " (>'-' )>   "
  ],
  dormido: [
    " ( -_- )    ",
    " ( -_- ) z  ",
    " ( -_- ) zZ ",
    " ( -_- ) zZZ"
  ],
  compactando: [
    " ( ◐.◐ )    ",
    " ( ◑.◑ )    ",
    " ( ◐.◐ )    "
  ],
  reintentando: [
    " ( ◐.̃◐ )    ",
    " ( ʘ◡ʘ )    ",
    " ( ◑.◑ )    "
  ],
  hablando: [
    " ( ʘ◡ʘ )    ",
    " ( ʘoʘ )    ", 
    " ( ʘ_ʘ )    ", 
    " ( ʘ.ʘ )    "
  ],
  permiso: [
    " ( ◐‿◐ )!  ",
    "!( ◐‿◐ )   "
  ],
  pregunta: [
    " ( ◐‿◐ )?  ",
    "?( ◐‿◐ )   "
  ],
};

// ── Carota grande dcdev (rail del sidebar). Port fiel del plugin OpenCode. ──
// NOTA: "trabajando" reusa COMPACT como en el original (ver WORK_FRAMES).
const BIG_DEFAULT: readonly string[] = [
  "   ~~~~~~~~~~~~~~~~~~~   ",
  "  /~~~~~~~~~~~~~~~~~~~\\  ",
  " |~~        ~        ~~| ",
  " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
  " │  ╔═════╗   ╔═════╗  │ ",
  " │══║  ♥  ║═══║  ♥  ║══│ ",
  " │  ╚═════╝   ╚═════╝  │ ",
  " │          ╩          │ ",
  "  \\                   /  ",
  "   \\    ╘═══════╛    /   ",
  "    \\     #####     /    ",
  "     └─────###─────┘     ",
];

const BIG_SLEEP: readonly string[][] = [
  [
    "   ~~~~~~~~~~~~~~~~~~~   ",
    "  /~~~~~~~~~~~~~~~~~~~\\  ",
    " |~~        ~        ~~| ",
    " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
    " │  ╔═════╗   ╔═════╗  │ ",
    " │══║ ≡≡≡ ║═══║ ≡≡≡ ║══│ ",
    " │  ╚═════╝   ╚═════╝  │ ",
    " │          ╩          │ ",
    "  \\                   /  ",
    "   \\        ═        /   ",
    "    \\     #####     /    ",
    "     └─────###─────┘     ",
  ],
  [
    "   ~~~~~~~~~~~~~~~~~~~   ",
    "  /~~~~~~~~~~~~~~~~~~~\\  ",
    " |~~        ~        ~~| ",
    " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
    " │  ╔═════╗   ╔═════╗  │ ",
    " │══║ ≡≡≡ ║═══║ ≡≡≡ ║══│ ",
    " │  ╚═════╝   ╚═════╝  │ ",
    " │          ╩          │ ",
    "  \\            z      /  ",
    "   \\        ═        /   ",
    "    \\     #####     /    ",
    "     └─────###─────┘     ",
  ],
  [
    "   ~~~~~~~~~~~~~~~~~~~   ",
    "  /~~~~~~~~~~~~~~~~~~~\\  ",
    " |~~        ~        ~~| ",
    " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
    " │  ╔═════╗   ╔═════╗  │ ",
    " │══║ ≡≡≡ ║═══║ ≡≡≡ ║══│ ",
    " │  ╚═════╝   ╚═════╝  │ ",
    " │          ╩          │ ",
    "  \\            z Z    /  ",
    "   \\     «═════»     /   ",
    "    \\     #####     /    ",
    "     └─────###─────┘     ",
  ],
  [
    "   ~~~~~~~~~~~~~~~~~~~   ",
    "  /~~~~~~~~~~~~~~~~~~~\\  ",
    " |~~        ~        ~~| ",
    " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
    " │  ╔═════╗   ╔═════╗  │ ",
    " │══║ ≡≡≡ ║═══║ ≡≡≡ ║══│ ",
    " │  ╚═════╝   ╚═════╝  │ ",
    " │          ╩          │ ",
    "  \\            z Z Z  /  ",
    "   \\    «═══════»    /   ",
    "    \\     #####     /    ",
    "     └─────###─────┘     ",
  ],
];

const BIG_THINK: readonly string[][] = [
  [
    "   ~~~~~~~~~~~~~~~~~~~   ",
    "  /~~~~~~~~~~~~~~~~~~~\\  ",
    " |~~        ~        ~~| ",
    " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
    " │  ╔═════╗   ╔═════╗  │ ",
    " │══║  ■  ║═══║  ■  ║══│ ",
    " │  ╚═════╝   ╚═════╝  │ ",
    " │          ╩          │ ",
    "  \\                   /  ",
    "   \\        ═        /   ",
    "    \\     #####     /    ",
    "     └─────###─────┘     ",
  ],
  [
    "   ~~~~~~~~~~~~~~~~~~~   ",
    "  /~~~~~~~~~~~~~~~~~~~\\  ",
    " |~~        ~        ~~| ",
    " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
    " │  ╔═════╗   ╔═════╗  │ ",
    " │══║  ■  ║═══║ ≡≡≡ ║══│ ",
    " │  ╚═════╝   ╚═════╝  │ ",
    " │          ╩          │ ",
    "  \\                   /  ",
    "   \\    «════        /   ",
    "    \\     #####     /    ",
    "     └─────###─────┘     ",
  ],
  [
    "   ~~~~~~~~~~~~~~~~~~~   ",
    "  /~~~~~~~~~~~~~~~~~~~\\  ",
    " |~~        ~        ~~| ",
    " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
    " │  ╔═════╗   ╔═════╗  │ ",
    " │══║  ■  ║═══║  ■  ║══│ ",
    " │  ╚═════╝   ╚═════╝  │ ",
    " │          ╩          │ ",
    "  \\                   /  ",
    "   \\        ═        /   ",
    "    \\     #####     /    ",
    "     └─────###─────┘     ",
  ],
  [
    "   ~~~~~~~~~~~~~~~~~~~   ",
    "  /~~~~~~~~~~~~~~~~~~~\\  ",
    " |~~        ~        ~~| ",
    " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
    " │  ╔═════╗   ╔═════╗  │ ",
    " │══║ ≡≡≡ ║═══║  ■  ║══│ ",
    " │  ╚═════╝   ╚═════╝  │ ",
    " │          ╩          │ ",
    "  \\                   /  ",
    "   \\        ════»    /   ",
    "    \\     #####     /    ",
    "     └─────###─────┘     ",
  ],
];

const BIG_WRITE: readonly string[][] = [
  [
    "   ~~~~~~~~~~~~~~~~~~~   ",
    "  /~~~~~~~~~~~~~~~~~~~\\  ",
    " |~~        ~        ~~| ",
    " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
    " │  ╔═════╗   ╔═════╗  │ ",
    " │══║ ≡≡≡ ║═══║ ≡≡≡ ║══│ ",
    " │  ╚═════╝   ╚═════╝  │ ",
    " │          ╩          │ ",
    "  \                   /  ",
    "   \    ╘═══════╛    /   ",
    "    \     #####     /    ",
    "     └─────###─────┘     ",
  ],
  [
    "   ~~~~~~~~~~~~~~~~~~~   ",
    "  /~~~~~~~~~~~~~~~~~~~\\  ",
    " |~~        ~        ~~| ",
    " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
    " │  ╔═════╗   ╔═════╗  │ ",
    " │══║  ■  ║═══║  ■  ║══│ ",
    " │  ╚═════╝   ╚═════╝  │ ",
    " │          ╩          │ ",
    "  \                   /  ",
    "   \    «═══════»    /   ",
    "    \     #####     /    ",
    "     └─────###─────┘     ",
  ],
  [
    "   ~~~~~~~~~~~~~~~~~~~   ",
    "  /~~~~~~~~~~~~~~~~~~~\\  ",
    " |~~        ~        ~~| ",
    " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
    " │  ╔═════╗   ╔═════╗  │ ",
    " │══║ ≡≡≡ ║═══║ ≡≡≡ ║══│ ",
    " │  ╚═════╝   ╚═════╝  │ ",
    " │          ╩          │ ",
    "  \                   /  ",
    "   \    ╒═══════╕    /   ",
    "    \     #####     /    ",
    "     └─────###─────┘     ",
  ],
];

const BIG_COMPACT: readonly string[][] = [
  [
    "   ~~~~~~~~~~~~~~~~~~~   ",
    "  /~~~~~~~~~~~~~~~~~~~\\  ",
    " |~~        ~        ~~| ",
    " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
    " │  ╔═════╗   ╔═════╗  │ ",
    " │══║  ■  ║═══║  ■  ║══│ ",
    " │  ╚═════╝   ╚═════╝  │ ",
    " │          ╩          │ ",
    "  \\                   /  ",
    "   \\      «═══»      /   ",
    "    \\     #####     /    ",
    "     └─────###─────┘     ",
  ],
  [
    "   ~~~~~~~~~~~~~~~~~~~   ",
    "  /~~~~~~~~~~~~~~~~~~~\\  ",
    " |~~        ~        ~~| ",
    " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
    " │  ╔═════╗   ╔═════╗  │ ",
    " │══║ ♦   ║═══║ ♦   ║══│ ",
    " │  ╚═════╝   ╚═════╝  │ ",
    " │          ╩          │ ",
    "  \\                   /  ",
    "   \\   «═══════»     /   ",
    "    \\    #####      /    ",
    "     └────###──────┘     ",
  ],
  [
    "   ~~~~~~~~~~~~~~~~~~~   ",
    "  /~~~~~~~~~~~~~~~~~~~\\  ",
    " |~~        ~        ~~| ",
    " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
    " │  ╔═════╗   ╔═════╗  │ ",
    " │══║  ■  ║═══║  ■  ║══│ ",
    " │  ╚═════╝   ╚═════╝  │ ",
    " │          ╩          │ ",
    "  \\                   /  ",
    "   \\      «═══»      /   ",
    "    \\     #####     /    ",
    "     └─────###─────┘     ",
  ],
  [
    "   ~~~~~~~~~~~~~~~~~~~   ",
    "  /~~~~~~~~~~~~~~~~~~~\\  ",
    " |~~        ~        ~~| ",
    " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
    " │  ╔═════╗   ╔═════╗  │ ",
    " │══║   ♦ ║═══║   ♦ ║══│ ",
    " │  ╚═════╝   ╚═════╝  │ ",
    " │          ╩          │ ",
    "  \\                   /  ",
    "   \\     «═══════»   /   ",
    "    \\      #####    /    ",
    "     └──────###────┘     ",
  ],
];
const BIG_WORK = BIG_COMPACT;

const BIG_RETRY: readonly string[][] = [
  [
    "   ~~~~~~~~~~~~~~~~~~~   ",
    "  /~~~~~~~~~~~~~~~~~~~\\  ",
    " |~~        ~        ~~| ",
    " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
    " │  ╔═════╗   ╔═════╗  │ ",
    " │══║  ♦  ║═══║  ♦  ║══│ ",
    " │  ╚═════╝   ╚═════╝  │ ",
    " │          ╩          │ ",
    "  \\                   /  ",
    "   \\      «═══»      /   ",
    "    \\     #####     /    ",
    "     └─────###─────┘     ",
  ],
  [
    "   ~~~~~~~~~~~~~~~~~~~   ",
    "  /~~~~~~~~~~~~~~~~~~~\\  ",
    " |~~        ~        ~~| ",
    " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
    " │  ╔═════╗   ╔═════╗  │ ",
    " │══║ ■   ║═══║ ■   ║══│ ",
    " │  ╚═════╝   ╚═════╝  │ ",
    " │          ╩          │ ",
    "  \\                   /  ",
    "   \\    ╘═══════╕    /   ",
    "    \\     #####     /    ",
    "     └─────###─────┘     ",
  ],
  [
    "   ~~~~~~~~~~~~~~~~~~~   ",
    "  /~~~~~~~~~~~~~~~~~~~\\  ",
    " |~~        ~        ~~| ",
    " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
    " │  ╔═════╗   ╔═════╗  │ ",
    " │══║  ♦  ║═══║  ♦  ║══│ ",
    " │  ╚═════╝   ╚═════╝  │ ",
    " │          ╩          │ ",
    "  \\                   /  ",
    "   \\      «═══»      /   ",
    "    \\     #####     /    ",
    "     └─────###─────┘     ",
  ],
  [
    "   ~~~~~~~~~~~~~~~~~~~   ",
    "  /~~~~~~~~~~~~~~~~~~~\\  ",
    " |~~        ~        ~~| ",
    " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
    " │  ╔═════╗   ╔═════╗  │ ",
    " │══║   ■ ║═══║   ■ ║══│ ",
    " │  ╚═════╝   ╚═════╝  │ ",
    " │          ╩          │ ",
    "  \\                   /  ",
    "   \\    ╒═══════╛    /   ",
    "    \\     #####     /    ",
    "     └─────###─────┘     ",
  ],
];

const BIG_TALK: readonly string[][] = [
  [
    "    ~~~~~~~~~~~~~~~~~    ",
    "  /~~~~~~~~~~~~~~~~~~~\\  ",
    " |~~        ~        ~~| ",
    " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
    " │  ╔═════╗   ╔═════╗  │ ",
    " │══║  ♥  ║═══║  ♥  ║══│ ",
    " │  ╚═════╝   ╚═════╝  │ ",
    " │          ╩          │ ",
    "  \\                   /  ",
    "   \\    ╘═══════╛    /   ",
    "    \\     #####     /    ",
    "     └─────###─────┘     ",
  ],
  [
    "    ~~~~~~~~~~~~~~~~~    ",
    "  /~~~~~~~~~~~~~~~~~~~\\  ",
    " |~~        ~        ~~| ",
    " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
    " │  ╔═════╗   ╔═════╗  │ ",
    " │══║  ■  ║═══║  ■  ║══│ ",
    " │  ╚═════╝   ╚═════╝  │ ",
    " │          ╩          │ ",
    "  \\      ╔═════╗      /  ",
    "   \\     ║     ║     /   ",
    "    \\    ╚═════╝    /    ",
    "     └─────###─────┘     ",
  ],
  [
    "    ~~~~~~~~~~~~~~~~~    ",
    "  /~~~~~~~~~~~~~~~~~~~\\  ",
    " |~~        ~        ~~| ",
    " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
    " │  ╔═════╗   ╔═════╗  │ ",
    " │══║  ■  ║═══║  ■  ║══│ ",
    " │  ╚═════╝   ╚═════╝  │ ",
    " │          ╩          │ ",
    "  \\       ╔═══╗       /  ",
    "   \\      ║   ║      /   ",
    "    \\     ╚═══╝     /    ",
    "     └─────###─────┘     ",
  ],
  [
    "    ~~~~~~~~~~~~~~~~~    ",
    "  /~~~~~~~~~~~~~~~~~~~\\  ",
    " |~~        ~        ~~| ",
    " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
    " │  ╔═════╗   ╔═════╗  │ ",
    " │══║  ■  ║═══║  ■  ║══│ ",
    " │  ╚═════╝   ╚═════╝  │ ",
    " │          ╩          │ ",
    "  \\                   /  ",
    "   \\        ═      /   ",
    "    \\     #####     /    ",
    "     └─────###─────┘     ",
  ],
  [
    "    ~~~~~~~~~~~~~~~~~    ",
    "  /~~~~~~~~~~~~~~~~~~~\\  ",
    " |~~        ~        ~~| ",
    " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
    " │  ╔═════╗   ╔═════╗  │ ",
    " │══║  ■  ║═══║  ■  ║══│ ",
    " │  ╚═════╝   ╚═════╝  │ ",
    " │          ╩          │ ",
    "  \\                   /  ",
    "   \\     «═════»     /   ",
    "    \\     #####     /    ",
    "     └─────###─────┘     ",
  ],
  [
    "    ~~~~~~~~~~~~~~~~~    ",
    "  /~~~~~~~~~~~~~~~~~~~\\  ",
    " |~~        ~        ~~| ",
    " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
    " │  ╔═════╗   ╔═════╗  │ ",
    " │══║  ■  ║═══║  ■  ║══│ ",
    " │  ╚═════╝   ╚═════╝  │ ",
    " │          ╩          │ ",
    "  \\     ╔═══════╗     /  ",
    "   \\    ║       ║    /   ",
    "    \\   ╚═══════╝   /    ",
    "     └─────###─────┘     ",
  ],
  [
    "    ~~~~~~~~~~~~~~~~~    ",
    "  /~~~~~~~~~~~~~~~~~~~\\  ",
    " |~~        ~        ~~| ",
    " │~  ▲▲▲▲▲     ▲▲▲▲▲  ~│ ",
    " │  ╔═════╗   ╔═════╗  │ ",
    " │══║  ■  ║═══║  ■  ║══│ ",
    " │  ╚═════╝   ╚═════╝  │ ",
    " │          ╩          │ ",
    "  \\                   /  ",
    "   \\    «═══════»    /   ",
    "    \\     #####     /    ",
    "     └─────###─────┘     ",
  ]
];

// ── Carota caja cubis (port del plugin OpenCode, perfil "cubis") ──
// NOTA: en el plugin OpenCode los nombres están cruzados: CUBIS_* = caja ┌─┐.
const CUBIS_DEFAULT = [
  "┌─────────────────────┐",
  "│  ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  │",
  "│  ╔═════╗   ╔═════╗  │",
  "│  ║  ♥  ║   ║  ♥  ║  │",
  "│  ╚═════╝   ╚═════╝  │",
  "│          ╩          │",
  "│                     │",
  "│      ╘═══════╛      │",
  "│                     │",
  "└─────────────────────┘",
] as const
const CUBIS_SLEEP: readonly string[][] = [
  [
    "┌─────────────────────┐",
    "│                     │",
    "│  ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  │",
    "│  ╞═════╡   ╞═════╡  │",
    "│                     │",
    "│          ╩          │",
    "│                     │",
    "│          ═          │",
    "│                     │",
    "└─────────────────────┘",
  ],
  [
    "┌─────────────────────┐",
    "│                     │",
    "│  ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  │",
    "│  ╞═════╡   ╞═════╡  │",
    "│                     │",
    "│          ╩          │",
    "│              z      │",
    "│          ═          │",
    "│                     │",
    "└─────────────────────┘",
  ],
  [
    "┌─────────────────────┐",
    "│                     │",
    "│  ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  │",
    "│  ╞═════╡   ╞═════╡  │",
    "│                     │",
    "│          ╩          │",
    "│              z Z    │",
    "│       «═════»       │",
    "│                     │",
    "└─────────────────────┘",
  ],
  [
    "┌─────────────────────┐",
    "│                     │",
    "│  ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  │",
    "│  ╞═════╡   ╞═════╡  │",
    "│                     │",
    "│          ╩          │",
    "│              z Z Z  │",
    "│      «═══════»      │",
    "│                     │",
    "└─────────────────────┘",
  ]
]
const CUBIS_THINK: readonly string[][] = [
  [
    "┌─────────────────────┐",
    "│  ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  │",
    "│  ╔═════╗   ╔═════╗  │",
    "│  ║  ♥  ║   ║  ♥  ║  │",
    "│  ╚═════╝   ╚═════╝  │",
    "│          ╩          │",
    "│                     │",
    "│      ╘═══════╛      │",
    "│                     │",
    "└─────────────────────┘",
  ],
  [
    "┌─────────────────────┐",
    "│  ▲▲▲▲▲▲▲           ?│",
    "│  ╔═════╗   ▲▲▲▲▲▲▲  │",
    "│  ║  ♦  ║   «═════»  │",
    "│  ╚═════╝            │",
    "│          ╩          │",
    "│                     │",
    "│      «════          │",
    "│                     │",
    "└─────────────────────┘",
  ],
  [
    "┌─────────────────────┐",
    "│  ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  │",
    "│  ╔═════╗   ╔═════╗  │",
    "│  ║  ■  ║   ║  ■  ║  │",
    "│  ╚═════╝   ╚═════╝  │",
    "│          ╩          │",
    "│                     │",
    "│          ═          │",
    "│                     │",
    "└─────────────────────┘",
  ],
  [
    "┌─────────────────────┐",
    "│!           ▲▲▲▲▲▲▲  │",
    "│  ▲▲▲▲▲▲▲   ╔═════╗  │",
    "│  «═════»   ║  ♦  ║  │",
    "│            ╚═════╝  │",
    "│          ╩          │",
    "│                     │",
    "│          ════»      │",
    "│                     │",
    "└─────────────────────┘",
  ]
]
const CUBIS_TALK: readonly string[][] = [
  [
    "┌─────────────────────┐",
    "│  ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  │",
    "│  ╔═════╗   ╔═════╗  │",
    "│  ║  ♥  ║   ║  ♥  ║  │",
    "│  ╚═════╝   ╚═════╝  │",
    "│          ╩          │",
    "│                     │",
    "│      ╘═══════╛      │",
    "│                     │",
    "└─────────────────────┘",
  ],
  [
    "┌─────────────────────┐",
    "│  ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  │",
    "│  ╔═════╗   ╔═════╗  │",
    "│  ║  ■  ║   ║  ■  ║  │",
    "│  ╚═════╝   ╚═════╝  │",
    "│          ╩          │",
    "│       ╔═════╗       │",
    "│       ║     ║       │",
    "│       ╚═════╝       │",
    "└─────────────────────┘",
  ],
  [
    "┌─────────────────────┐",
    "│  ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  │",
    "│  ╔═════╗   ╔═════╗  │",
    "│  ║  ■  ║   ║  ■  ║  │",
    "│  ╚═════╝   ╚═════╝  │",
    "│          ╩          │",
    "│        ╔═══╗        │",
    "│        ║   ║        │",
    "│        ╚═══╝        │",
    "└─────────────────────┘",
  ],
  [
    "┌─────────────────────┐",
    "│  ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  │",
    "│  ╔═════╗   ╔═════╗  │",
    "│  ║  ■  ║   ║  ■  ║  │",
    "│  ╚═════╝   ╚═════╝  │",
    "│          ╩          │",
    "│                     │",
    "│          ═          │",
    "│                     │",
    "└─────────────────────┘",
  ],
  [
    "┌─────────────────────┐",
    "│  ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  │",
    "│  ╔═════╗   ╔═════╗  │",
    "│  ║  ■  ║   ║  ■  ║  │",
    "│  ╚═════╝   ╚═════╝  │",
    "│          ╩          │",
    "│                     │",
    "│      «═══════»      │",
    "│                     │",
    "└─────────────────────┘",
  ],
  [
    "┌─────────────────────┐",
    "│  ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  │",
    "│  ╔═════╗   ╔═════╗  │",
    "│  ║  ■  ║   ║  ■  ║  │",
    "│  ╚═════╝   ╚═════╝  │",
    "│          ╩          │",
    "│     ╔═════════╗     │",
    "│     ║         ║     │",
    "│     ╚═════════╝     │",
    "└─────────────────────┘",
  ],
  [
    "┌─────────────────────┐",
    "│  ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  │",
    "│  ╔═════╗   ╔═════╗  │",
    "│  ║  ■  ║   ║  ■  ║  │",
    "│  ╚═════╝   ╚═════╝  │",
    "│          ╩          │",
    "│                     │",
    "│        «═══»        │",
    "│                     │",
    "└─────────────────────┘",
  ],
]
const CUBIS_WRITE: readonly string[][] = [
  [
    "┌─────────────────────┐",
    "│  ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  │",
    "│  ╔═════╗   ╔═════╗  │",
    "│  ║  ♥  ║   ║  ♥  ║  │",
    "│  ╚═════╝   ╚═════╝  │",
    "│          ╩          │",
    "│                     │",
    "│      ╘═══════╛      │",
    "│                     │",
    "└─────────────────────┘",
  ],
  [
    "┌─────────────────────┐",
    "│  ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  │",
    "│                     │",
    "│  ╞═════╡   ╞═════╡  │",
    "│                     │",
    "│          ╩          │",
    "│                     │",
    "│      ╘═══════╛      │",
    "│                     │",
    "└─────────────────────┘",
  ],
  [
    "┌─────────────────────┐",
    "│  ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  │",
    "│  ╔═════╗   ╔═════╗  │",
    "│  ║  ■  ║   ║  ■  ║  │",
    "│  ╚═════╝   ╚═════╝  │",
    "│          ╩          │",
    "│                     │",
    "│      «═══════»      │",
    "│                     │",
    "└─────────────────────┘",
  ],
  [
    "┌─────────────────────┐",
    "│  ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  │",
    "│                     │",
    "│  ╞═════╡   ╞═════╡  │",
    "│                     │",
    "│          ╩          │",
    "│                     │",
    "│      ╒═══════╕      │",
    "│                     │",
    "└─────────────────────┘",
  ],
  [
    "┌─────────────────────┐",
    "│  ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  │",
    "│  ╔═════╗   ╔═════╗  │",
    "│  ║  ♥  ║   ║  ♥  ║  │",
    "│  ╚═════╝   ╚═════╝  │",
    "│          ╩          │",
    "│                     │",
    "│      ╘═══════╛      │",
    "│                     │",
    "└─────────────────────┘",
  ],
]
const CUBIS_COMPACT: readonly string[][] = [
  [
    "┌─────────────────────┐",
    "│  ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  │",
    "│  ╔═════╗   ╔═════╗  │",
    "│  ║ ♦   ║   ║ ♦   ║  │",
    "│  ╚═════╝   ╚═════╝  │",
    "│          ╩          │",
    "│                     │",
    "│      «═══════»      │",
    "│                     │",
    "└─────────────────────┘",
  ],
  [
    "┌─────────────────────┐",
    "│  ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  │",
    "│  ╔═════╗   ╔═════╗  │",
    "│  ║  ■  ║   ║  ■  ║  │",
    "│  ╚═════╝   ╚═════╝  │",
    "│          ╩          │",
    "│                     │",
    "│        «═══»        │",
    "│                     │",
    "└─────────────────────┘",
  ],
  [
    "┌─────────────────────┐",
    "│  ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  │",
    "│  ╔═════╗   ╔═════╗  │",
    "│  ║   ♦ ║   ║   ♦ ║  │",
    "│  ╚═════╝   ╚═════╝  │",
    "│          ╩          │",
    "│                     │",
    "│      «═══════»      │",
    "│                     │",
    "└─────────────────────┘",
  ],
]
const CUBIS_RETRY: readonly string[][] = [
  [
    "┌─────────────────────┐",
    "│  ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  │",
    "│  ╔═════╗   ╔═════╗  │",
    "│  ║  ♦  ║   ║  ♦  ║  │",
    "│  ╚═════╝   ╚═════╝  │",
    "│          ╩          │",
    "│                     │",
    "│        «═══»        │",
    "│                     │",
    "└─────────────────────┘",
  ],
  [
    "┌─────────────────────┐",
    "│  ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  │",
    "│  ╔═════╗   ╔═════╗  │",
    "│  ║ ■   ║   ║ ■   ║  │",
    "│  ╚═════╝   ╚═════╝  │",
    "│          ╩          │",
    "│                     │",
    "│      ╘═══════╕      │",
    "│                     │",
    "└─────────────────────┘",
  ],
  [
    "┌─────────────────────┐",
    "│  ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  │",
    "│  ╔═════╗   ╔═════╗  │",
    "│  ║  ♦  ║   ║  ♦  ║  │",
    "│  ╚═════╝   ╚═════╝  │",
    "│          ╩          │",
    "│                     │",
    "│        «═══»        │",
    "│                     │",
    "└─────────────────────┘",
  ],
  [
    "┌─────────────────────┐",
    "│  ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  │",
    "│  ╔═════╗   ╔═════╗  │",
    "│  ║   ■ ║   ║   ■ ║  │",
    "│  ╚═════╝   ╚═════╝  │",
    "│          ╩          │",
    "│                     │",
    "│      ╒═══════╛      │",
    "│                     │",
    "└─────────────────────┘",
  ],
]

type ProfileId = "dcdev" | "cubis";


function bigFramesFor(profile: ProfileId, mode: Mode): readonly string[][] | null {
  const box = profile === "cubis";
  switch (mode) {
    case "pensando":
      return box ? CUBIS_THINK : BIG_THINK;
    case "escribiendo":
      return box ? CUBIS_WRITE : BIG_WRITE;
    case "trabajando":
      return box ? CUBIS_WRITE : BIG_WORK;
    case "dormido":
      return box ? CUBIS_SLEEP : BIG_SLEEP;
    case "compactando":
      return box ? CUBIS_COMPACT : BIG_COMPACT;
    case "reintentando":
      return box ? CUBIS_RETRY : BIG_RETRY;
    case "hablando":
      return box ? CUBIS_TALK : BIG_TALK;
    default:
      return null; // feliz / permiso / pregunta = cara base fija
  }
}

function bigDefaultFor(profile: ProfileId): readonly string[] {
  return profile === "cubis" ? CUBIS_DEFAULT : BIG_DEFAULT;
}

const DOT: Record<Mode, string> = {
  feliz: "●",
  pensando: "●",
  escribiendo: "●",
  trabajando: "●",
  dormido: "○",
  compactando: "◐",
  reintentando: "◐",
  hablando: "▶",
  permiso: "!",
  pregunta: "?",
};

// Coloreado por caracter, port fiel del plugin OpenCode (mismo orden de reglas).
// Roles = claves de la paleta Pi (el tema Dc-Sangre los mapea a sus rojos).
const paintBigLine = (line: string, fg: (color: string, text: string) => string): string => {
  return Array.from(line)
    .map((ch, idx) => {
      let role = "accent";
      const isOuter =
        ch === "┌" || ch === "┐" || ch === "└" || ch === "┘" ||
        (ch === "─" && (line.trim().startsWith("┌") || line.trim().startsWith("└"))) ||
        (ch === "│" && (idx === 0 || idx === line.length - 1));
      if (isOuter) role = "error";
      else if ("~".includes(ch)) role = "text";
      else if ("▲".includes(ch)) role = "error";
      else if ("╔║╚╞╒╝╗╛╕╜╖".includes(ch)) role = "text";
      else if ("═".includes(ch) && line.includes("╔")) role = "text";
      else if ("♥".includes(ch)) role = "error";
      else if ("■♦≡".includes(ch)) role = "accent";
      else if ("╩‖".includes(ch)) role = "muted";
      else if ("╘╬╕╒«»═╝╗╛╜╖".includes(ch)) role = "text";
      else if ("#".includes(ch)) role = "error";
      else if ("zZ".includes(ch)) role = "muted";
      else if ("?!".includes(ch)) role = "warning";
      return fg(role, ch);
    })
    .join("");
};

// Estado compartido del sidebar de gentle-pi. Vive en el terminal (no en un
// singleton de modulo) justamente para que extensiones aisladas por el loader
// puedan registrar secciones. Ver gentle-pi lib/shell-sidebar.ts.
const SIDEBAR_STATE = Symbol.for("gentle-pi.experimental-sidebar.state");
interface SidebarPart {
  render(width: number): string[];
  invalidate(): void;
}
interface MinimalTui {
  requestRender(): void;
  terminal?: unknown;
}

// ── Modal flotante cuadrado (mismo estilo previu/caritas) ──
// Header con titulo, separador que engancha a los bordes, caja ┌┐└┘│.

class FaceTitleBar {
  private left: string;
  private right: string;

  constructor(left: string, right: string) {
    this.left = left;
    this.right = right;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const gap = Math.max(2, width - visibleWidth(this.left) - visibleWidth(this.right));
    return [truncateToWidth(`${this.left}${" ".repeat(gap)}${this.right}`, width)];
  }
}

class FaceRule {
  private color: (s: string) => string;

  constructor(color: (s: string) => string) {
    this.color = color;
  }

  invalidate(): void {}

  render(width: number): string[] {
    return [this.color("├" + "─".repeat(Math.max(1, width - 2)) + "┤")];
  }
}

class FaceBox {
  private content: {
    render(width: number): string[];
    invalidate(): void;
  };
  private color: (s: string) => string;

  constructor(
    content: { render(width: number): string[]; invalidate(): void },
    color: (s: string) => string,
  ) {
    this.content = content;
    this.color = color;
  }

  invalidate(): void {
    this.content.invalidate();
  }

  render(width: number): string[] {
    const inner = Math.max(4, width - 2);
    const top = this.color("┌" + "─".repeat(inner) + "┐");
    const bottom = this.color("└" + "─".repeat(inner) + "┘");
    const side = this.color("│");
    const lines = this.content.render(inner).map((line) => {
      const v = visibleWidth(line);
      const cell =
        v > inner ? truncateToWidth(line, inner) : line + " ".repeat(inner - v);
      return `${side}${cell}${side}`;
    });
    return [top, ...lines, bottom];
  }
}

interface DuelTheme {
  fg: (color: string, text: string) => string;
  bold: (text: string) => string;
}

// ── Duelo dcdev vs cubis lado a lado: ←→ o click para elegir, enter usa, esc sale ──
class ProfileDuel {
  selected: 0 | 1;
  onPick: ((p: ProfileId) => void) | null = null;
  onCancel: (() => void) | null = null;
  private lastColW = 0;
  private lastH = 0;
  private header: FaceTitleBar;
  private footer: FaceTitleBar;
  private rule: FaceRule;

  constructor(
    private theme: DuelTheme,
    current: ProfileId,
  ) {
    this.selected = current === "cubis" ? 1 : 0;
    const fg = theme.fg;
    this.header = new FaceTitleBar(
      `  ${fg("accent", theme.bold("carita — Alt+c · ¿dcdev o cubis?"))}`,
      "",
    );
    this.footer = new FaceTitleBar(
      `  ${fg("accent", "←→")} ${fg("dim", "elegir")}   ${fg("accent", "enter")} ${fg("dim", "usar")}   ${fg("accent", "esc")} ${fg("dim", "cerrar")}`,
      `${fg("accent", "[ Usar ]")}  `,
    );
    this.rule = new FaceRule((str: string) => fg("accent", str));
  }

  invalidate(): void {}

  private metrics(inner: number) {
    const colW = Math.max(20, Math.floor((inner - 3) / 2));
    const H = Math.max(BIG_DEFAULT.length, CUBIS_DEFAULT.length);
    return { colW, H };
  }

  private faceCell(
    lines: readonly string[],
    selected: boolean,
    colW: number,
    H: number,
  ): string[] {
    const fg = this.theme.fg;
    const w = Math.max(...lines.map((l) => visibleWidth(l)));
    const norm = lines.map((l) => l + " ".repeat(Math.max(0, w - visibleWidth(l))));
    const top = Math.floor((H - norm.length) / 2);
    const full: string[] = [
      ...Array<string>(Math.max(0, top)).fill(" ".repeat(w)),
      ...norm,
      ...Array<string>(Math.max(0, H - top - norm.length)).fill(" ".repeat(w)),
    ];
    return full.map((l) => {
      const painted = selected ? paintBigLine(l, fg) : fg("dim", l);
      const lp = Math.floor((colW - w) / 2);
      const rp = Math.max(0, colW - w - lp);
      return " ".repeat(Math.max(0, lp)) + painted + " ".repeat(rp);
    });
  }

  private label(text: string, selected: boolean, colW: number): string {
    const fg = this.theme.fg;
    const raw = `${selected ? "◉" : "○"} ${text}`;
    const styled = selected ? fg("accent", this.theme.bold(raw)) : fg("dim", raw);
    const lp = Math.floor((colW - visibleWidth(raw)) / 2);
    return (
      " ".repeat(Math.max(0, lp)) +
      styled +
      " ".repeat(Math.max(0, colW - lp - visibleWidth(raw)))
    );
  }

  render(width: number): string[] {
    const inner = width;
    const { colW, H } = this.metrics(inner);
    this.lastColW = colW;
    this.lastH = H;
    const fg = this.theme.fg;
    const left = this.faceCell(BIG_DEFAULT, this.selected === 0, colW, H);
    const right = this.faceCell(CUBIS_DEFAULT, this.selected === 1, colW, H);
    const div = fg("accent", "│");
    const rows = left.map((l, i) => `${l} ${div} ${right[i]}`);
    return [
      ...this.header.render(inner),
      ...this.rule.render(inner),
      "",
      ...rows,
      `${this.label("dcdev", this.selected === 0, colW)} ${div} ${this.label("cubis", this.selected === 1, colW)}`,
      "",
      ...this.rule.render(inner),
      ...this.footer.render(inner),
    ];
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.left) || matchesKey(data, Key.up)) this.selected = 0;
    else if (matchesKey(data, Key.right) || matchesKey(data, Key.down)) this.selected = 1;
    else if (matchesKey(data, Key.enter))
      this.onPick?.(this.selected === 1 ? "cubis" : "dcdev");
    else if (matchesKey(data, Key.escape)) this.onCancel?.();
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "wheel") return undefined;
    if (event.button !== "left" || (event.type !== "press" && event.type !== "click"))
      return undefined;
    // filas 3..3+H: carotas + fila de etiquetas (0=header,1=rule,2=aire)
    if (event.y < 3 || event.y > 3 + this.lastH) return undefined;
    const side = event.x > this.lastColW + 1 ? 1 : 0;
    if (event.type === "press") {
      this.selected = side as 0 | 1;
      return { handled: true, focus: true };
    }
    this.selected = side as 0 | 1;
    this.onPick?.(side === 1 ? "cubis" : "dcdev");
    return { handled: true };
  }
}

export default function (pi: ExtensionAPI) {
  let mode: Mode = "feliz";
  let profile: ProfileId = "dcdev";
  let modalOpen = false;
  let unsubInput: (() => void) | null = null;
  let frameIdx = 0;
  let hidden = false;
  let busy = false;
  let toolsRunning = 0;
  let uiPrompt: string | null = null;
  let lastTtsPlayingAt = 0;
  let ttsStatus: "idle" | "playing" = "idle";
  let ttsAvailable: boolean | null = null;
  let ctxRef: ExtensionContext | null = null;
  let tuiRef: MinimalTui | null = null;
  let lastSent: string | undefined | null = null;
  let lastGate: boolean | null = null;

  let anim: ReturnType<typeof setInterval> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let talkCheck: ReturnType<typeof setTimeout> | null = null;
  let ttsPoll: ReturnType<typeof setInterval> | null = null;
  let demoTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = () => {
    if (anim) clearInterval(anim);
    if (idleTimer) clearTimeout(idleTimer);
    if (retryTimer) clearTimeout(retryTimer);
    if (talkCheck) clearTimeout(talkCheck);
    if (ttsPoll) clearInterval(ttsPoll);
    if (demoTimer) clearTimeout(demoTimer);
    demoTimer = null;
    anim = idleTimer = retryTimer = talkCheck = ttsPoll = null;
  };

  const sidebarParts = (): Map<string, SidebarPart> | null => {
    try {
      const term = tuiRef?.terminal as Record<symbol, { parts?: Map<string, SidebarPart> }> | undefined;
      return term?.[SIDEBAR_STATE]?.parts ?? null;
    } catch {
      return null;
    }
  };

  const currentBigFrame = (): string[] => {
    const f = bigFramesFor(profile, mode);
    if (!f || f.length === 0) return [...bigDefaultFor(profile)];
    return [...(f[frameIdx % f.length] ?? f[0]!)] as string[];
  };

  const railLines = (width: number): string[] => {
    if (hidden) return [];
    const theme = ctxRef?.ui.theme;
    const fg = theme
      ? (color: string, text: string) => theme.fg(color, text)
      : (_color: string, text: string) => text;
    // Responsive al alto: si el terminal se acorta, la carota no entra → mini.
    const rows = (tuiRef?.terminal as { rows?: number } | undefined)?.rows ?? 0;
    const useBig = rows === 0 || rows >= BIG_FACE_MIN_ROWS;
    const miniFrames = FACES[mode];
    const face = useBig
      ? currentBigFrame().map((line) => paintBigLine(line, fg))
      : [fg("accent", miniFrames[frameIdx % miniFrames.length] ?? miniFrames[0] ?? "")];
    const label =
      fg("accent", `${DOT[mode]} ${mode} ${ttsStatus === "playing" ? "▶ tts" : "○ tts"} `) +
      fg("muted", `[${profile}]`);
    const w = Math.max(1, width);
    // Centrada en el rail (misma metrica que el guard de ancho del layout,
    // mas truncate defensivo para no voltear nunca el sidebar).
    return ["", ...face, "", label].map((line) => {
      const pad = Math.max(0, Math.floor((w - visibleWidth(line)) / 2));
      return truncateToWidth(" ".repeat(pad) + line, w, "");
    });
  };

  const faceRail: SidebarPart = {
    render(width: number): string[] {
      return railLines(width);
    },
    invalidate() {
      bumpSidebarCache();
    },
  };

  const registerRail = () => {
    sidebarParts()?.set("face", faceRail);
  };

  // gentle-pi cachea el sidebar (prepare() reusa faceLines si no cambia la
  // revision). Sin esto, la carita queda congelada: ni estados ni animación.
  const bumpSidebarCache = () => {
    try {
      const term = tuiRef?.terminal as Record<symbol, { revision?: number }> | undefined;
      const cache = term?.[Symbol.for("gentle-pi.experimental-sidebar.cache")];
      if (cache) cache.revision = (cache.revision ?? 0) + 1;
    } catch {
      /* noop */
    }
  };

  const unregisterRail = () => {
    try {
      const parts = sidebarParts();
      if (parts?.get("face") === faceRail) parts.delete("face");
    } catch {
      /* noop */
    }
  };

  const requestRender = () => {
    try {
      tuiRef?.requestRender();
    } catch {
      /* noop */
    }
  };

  // Rail activo = la carota grande ya se ve abajo del sidebar: la linea de
  // Integrations sobra y se oculta. Rail inactivo = se muestra la mini.
  const sidebarActive = (): boolean => {
    try {
      const gVis = (globalThis as unknown as Record<symbol, boolean | undefined>)[
        Symbol.for("dc.sidebar.rail-visible")
      ];
      if (typeof gVis === "boolean") return gVis;
      const term = tuiRef?.terminal as Record<symbol, unknown> | undefined;
      if (term?.[Symbol.for("dc.sidebar.rail-visible")] === true) return true;
      const st = term?.[SIDEBAR_STATE] as { active?: boolean } | undefined;
      if (typeof st?.active === "boolean") return st.active;
      return !isSidebarHidden();
    } catch {
      return false;
    }
  };

  const paint = () => {
    if (!ctxRef) return;
    // undefined = no mandar nada (oculto o rail activo con la grande visible).
    let next: string | undefined;
    let plain = "";
    if (!hidden && !sidebarActive()) {
      const faces = FACES[mode];
      const face = faces[frameIdx % faces.length] ?? faces[0]!;
      const tts = ttsStatus === "playing" ? " ▶" : "";
      plain = `${mode} ${face}${tts}`;
      next = ctxRef.ui.theme.fg("accent", plain);
    }
    // Expone la mini-carita en texto plano: dc-sidebar la mueve junto al brand.
    try {
      (globalThis as unknown as Record<symbol, string>)[Symbol.for("dc.face.mini")] = plain;
    } catch {
      /* noop */
    }
    // Dedup: setStatus dispara requestRender, no spamear si no cambio.
    if (next !== lastSent) {
      lastSent = next;
      try {
        ctxRef.ui.setStatus("dc-face", next);
      } catch {
        /* noop */
      }
    }
    requestRender();
  };

  const paintIndicator = () => {
    if (!ctxRef || hidden) return;
    const theme = ctxRef.ui.theme;
    try {
      if (mode === "pensando" || mode === "reintentando") {
        ctxRef.ui.setWorkingIndicator({
          frames: ["◐", "◑", "◒", "◓"].map((s) => theme.fg("accent", s)),
          intervalMs: 120,
        });
      } else if (mode === "trabajando" || mode === "compactando") {
        ctxRef.ui.setWorkingIndicator({
          frames: ["<", "^", ">", "v"].map((s) => theme.fg("accent", s)),
          intervalMs: 150,
        });
      } else if (mode === "escribiendo" || mode === "hablando") {
        ctxRef.ui.setWorkingIndicator({
          frames: ["·", "•", "●", "•"].map((s) => theme.fg("accent", s)),
          intervalMs: 150,
        });
      } else {
        ctxRef.ui.setWorkingIndicator(undefined); // spinner default de pi
      }
    } catch {
      /* noop */
    }
  };

  const setMode = (next: Mode) => {
    if (mode === next) return;
    mode = next;
    frameIdx = 0;
    bumpSidebarCache();
    paint();
    paintIndicator();
  };

  const backToIdle = () => {
    if (uiPrompt) {
      setMode(uiPrompt === "confirm" ? "permiso" : "pregunta");
      return;
    }
    if (busy || toolsRunning > 0) return;
    setMode("feliz");
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!busy && toolsRunning === 0 && !uiPrompt && ttsStatus !== "playing") {
        setMode("dormido");
      }
    }, IDLE_TO_SLEEP_MS);
  };

  const isTalking = () => mode === "hablando" || ttsStatus === "playing";

  const pollTts = async () => {
    if (ttsAvailable === false || !ctxRef) return;
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 1000);
    try {
      const res = await fetch(`${BRIDGE_URL}/status`, { signal: ac.signal });
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as { status?: string; state?: string };
      ttsAvailable = true;
      const st = String(j.status ?? j.state ?? "idle").toLowerCase();
      if (st === "playing" || st === "paused") {
        ttsStatus = "playing";
        lastTtsPlayingAt = Date.now();
        if (!busy && !uiPrompt && mode !== "hablando") setMode("hablando");
        else paint();
      } else {
        const was = ttsStatus;
        ttsStatus = "idle";
        if (was === "playing" && mode === "hablando" && !busy) backToIdle();
        else if (was === "playing") paint();
      }
    } catch {
      ttsAvailable = false;
      ttsStatus = "idle";
    } finally {
      clearTimeout(to);
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    ctxRef = ctx;
    // Click en la cara (desde dc-sidebar) → demo de caras.
    (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("dc.face.demo")] = () => {
      try {
        if (demoTimer) stopDemo();
        else if (ctxRef) startDemo(ctxRef);
      } catch {
        /* noop */
      }
    };
    clearTimers();
    mode = "feliz";
    frameIdx = 0;
    busy = false;
    toolsRunning = 0;
    uiPrompt = null;
    hidden = false;
    lastSent = null;
    lastGate = null;
    try {
      ctx.ui.setWidget("dc-face", undefined);
    } catch {
      /* noop */
    }
    if (!ctx.hasUI) return;

    // Ancla invisible solo para capturar el tui (requestRender del rail).
    // El widget pinta cero lineas; la parte visible vive en el sidebar.
    try {
      ctx.ui.setWidget(
        "dc-face-anchor",
        (tui) => {
          tuiRef = tui as unknown as MinimalTui;
          registerRail();
          return { render: (_width: number) => [] as string[], invalidate() {} };
        },
        { placement: "belowEditor" },
      );
    } catch {
      /* noop */
    }

    paint();
    paintIndicator();
    registerRail();

    // Gatillo global Alt+C: si un editor custom se traga el shortcut,
    // escuchamos el teclado directo (consume la tecla, no duplica).
    unsubInput?.();
    unsubInput = ctx.ui.onTerminalInput((data: string) => {
      if (!matchesKey(data, "alt+c")) return undefined;
      if (modalOpen) return { consume: true };
      void showProfilePick(ctx);
      return { consume: true };
    });

    anim = setInterval(() => {
      if (hidden) return;
      // Self-heal arranque en frio: el anchor puede montarse antes de que
      // gentle-shell cree el estado del sidebar en el terminal y el register
      // inicial se pierde en silencio (sidebarParts() null). Re-registrar es
      // un Map.set idempotente con la misma instancia: barato y seguro.
      registerRail();
      const mini = FACES[mode];
      const big = bigFramesFor(profile, mode);
      const animated = mini.length > 1 || (big !== null && big.length > 1);
      // El rail puede activarse/desactivarse por resize: reevaluar el gate
      // aunque el modo este estatico (ej. feliz tras achicar el terminal).
      const gate = sidebarActive();
      const gateChanged = lastGate !== gate;
      lastGate = gate;
      if (animated) frameIdx += 1;
      if (animated || gateChanged) {
        bumpSidebarCache();
        paint();
      }
    }, ANIM_MS);

    ttsAvailable = null;
    void pollTts();
    ttsPoll = setInterval(() => void pollTts(), 1500);

    backToIdle();
  });

  pi.on("session_shutdown", async () => {
    clearTimers();
    unregisterRail();
    try {
      ctxRef?.ui.setWidget("dc-face", undefined);
      ctxRef?.ui.setWidget("dc-face-anchor", undefined);
      ctxRef?.ui.setStatus("dc-face", undefined);
      ctxRef?.ui.setWorkingIndicator(undefined);
    } catch {
      /* noop */
    }
    unsubInput?.();
    unsubInput = null;
    ctxRef = null;
    tuiRef = null;
  });

  // ── Mapeo de estados del agente Pi ──
  pi.on("agent_start", async () => {
    busy = true;
    if (mode === "dormido" || mode === "feliz") setMode("pensando");
  });

  pi.on("turn_start", async () => {
    busy = true;
    if (!isTalking() && uiPrompt === null && mode !== "trabajando") setMode("pensando");
  });

  pi.on("message_start", async (event) => {
    const m = (event as { message?: { role?: string } }).message;
    if (m?.role === "assistant" && !isTalking() && uiPrompt === null) {
      if (mode !== "trabajando") setMode("pensando");
    }
  });

  pi.on("message_update", async () => {
    if (!isTalking() && uiPrompt === null && toolsRunning === 0) setMode("escribiendo");
  });

  pi.on("tool_execution_start", async () => {
    toolsRunning += 1;
    busy = true;
    if (!isTalking() && uiPrompt === null) setMode("trabajando");
  });

  pi.on("tool_execution_end", async (event) => {
    toolsRunning = Math.max(0, toolsRunning - 1);
    const err = (event as { isError?: boolean }).isError;
    if (err) {
      setMode("reintentando");
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        if (toolsRunning > 0) setMode("trabajando");
        else if (busy) setMode("pensando");
        else backToIdle();
      }, RETRY_FLASH_MS);
    } else if (toolsRunning === 0 && !isTalking() && uiPrompt === null) {
      setMode(busy ? "pensando" : "feliz");
    }
  });

  pi.on("agent_end", async () => {
    if (toolsRunning > 0) setMode("trabajando");
  });

  pi.on("agent_settled", async () => {
    busy = false;
    if (toolsRunning > 0) {
      setMode("trabajando");
      return;
    }
    if (!uiPrompt && ttsAvailable !== false) {
      setMode("hablando");
      if (talkCheck) clearTimeout(talkCheck);
      talkCheck = setTimeout(() => {
        if (mode === "hablando" && ttsStatus !== "playing") backToIdle();
      }, TTS_GRACE_MS);
    } else {
      backToIdle();
    }
  });

  pi.on("session_before_compact", async () => setMode("compactando"));

  pi.on("session_compact", async () => {
    busy = false;
    backToIdle();
  });

  pi.on("session_compact_failed", async () => setMode("reintentando"));

  pi.on("ui_prompt_start", async (event) => {
    const kind = (event as { kind?: string }).kind ?? "select";
    uiPrompt = kind;
    setMode(kind === "confirm" ? "permiso" : "pregunta");
  });

  pi.on("ui_prompt_end", async () => {
    uiPrompt = null;
    if (!busy && toolsRunning === 0) backToIdle();
    else setMode(toolsRunning > 0 ? "trabajando" : "pensando");
  });

  // ── Demo de caras: recorre todos los modos/frames para revisar el arte ──
  const DEMO_MS = 700;

  const stopDemo = () => {
    if (demoTimer) clearTimeout(demoTimer);
    demoTimer = null;
    busy = false;
    try {
      ctxRef?.ui.setStatus("dc-face", undefined);
    } catch {
      /* noop */
    }
  };

  const startDemo = (ctx: ExtensionContext, only?: Mode) => {
    stopDemo();
    busy = true; // evita que el idle timer pise el demo
    const modes = only ? [only] : (Object.keys(DOT) as Mode[]);
    const steps: Array<{ mode: Mode; frame: number }> = [];
    for (const m of modes) {
      const big = bigFramesFor(profile, m) ?? [bigDefaultFor(profile)];
      for (let f = 0; f < big.length; f++) steps.push({ mode: m, frame: f });
    }
    let i = 0;
    const step = () => {
      const s = steps[i];
      if (!s) {
        stopDemo();
        setMode("feliz");
        try {
          ctx.ui.notify(`Demo de caras: fin (${profile})`, "info");
        } catch {
          /* noop */
        }
        return;
      }
      mode = s.mode;
      frameIdx = s.frame;
      bumpSidebarCache();
      paint();
      paintIndicator();
      requestRender();
      try {
        if (!sidebarActive()) {
          ctx.ui.setStatus(
            "dc-face",
            ctx.ui.theme.fg("accent", `demo ${i + 1}/${steps.length} · ${s.mode} f${s.frame + 1}`),
          );
        } else {
          ctx.ui.setStatus("dc-face", undefined);
        }
      } catch {
        /* noop */
      }
      i += 1;
      demoTimer = setTimeout(step, DEMO_MS);
    };
    step();
  };

  pi.registerCommand("face", {
    description: "Carita dc-dev: ver estado, ocultar/mostrar, cambiar perfil (/face cubis|dcdev).",
    handler: async (args, ctx) => {
      const sub = args.trim().toLowerCase();
      if (sub === "pick") {
        await showProfilePick(ctx);
        return;
      }
      if (sub === "demo off") {
        stopDemo();
        setMode("feliz");
        ctx.ui.notify("Demo de caras detenido", "info");
        return;
      }
      if (sub === "demo" || sub.startsWith("demo ")) {
        stopDemo();
        const only = sub.split(/\s+/)[1] as Mode | undefined;
        startDemo(ctx, only);
        ctx.ui.notify(`Demo de caras (${profile})${only ? ` · ${only}` : ""} — /face demo off para parar`, "info");
        return;
      }
      if (sub === "cubis" || sub === "dcdev") {
        profile = sub;
        frameIdx = 0;
        paint();
        requestRender();
        const faces = FACES[mode];
        const face = faces[frameIdx % faces.length] ?? faces[0]!;
        ctx.ui.notify(`Carita: perfil ${profile} · ${mode} ${face}`, "info");
        return;
      }
      if (sub === "hide") {
        hidden = true;
        try {
          ctx.ui.setStatus("dc-face", undefined);
          ctx.ui.setWorkingIndicator(undefined);
        } catch {
          /* noop */
        }
        requestRender();
        ctx.ui.notify("Carita ocultada (/face show para traerla de vuelta)", "info");
        return;
      }
      if (sub === "show") {
        hidden = false;
        ctxRef = ctx;
        frameIdx = 0;
        paint();
        paintIndicator();
        ctx.ui.notify("Carita visible", "info");
        return;
      }
      ctx.ui.notify(`Carita: ${hidden ? "oculta" : `${mode} ${FACES[mode][frameIdx % FACES[mode].length]}`} (tts: ${ttsStatus})`, "info");
        },
      });

      // ── Picker Alt+C: duelo dcdev vs cubis lado a lado ──
      async function showProfilePick(ctx: ExtensionContext): Promise<void> {
        if (modalOpen) return;
        if (!ctx.hasUI || ctx.mode !== "tui") {
          ctx.ui.notify("El picker necesita TUI (usá /face cubis|dcdev en este modo).", "error");
          return;
        }
        modalOpen = true;
        try {
        const pick = await ctx.ui.custom<ProfileId | null>(
          (tui, theme, _kb, done) => {
            const duel = new ProfileDuel(
              {
                fg: (c, t) => theme.fg(c, t),
                bold: (t) => theme.bold(t),
              },
              profile,
            );
            duel.onPick = (p) => done(p);
            duel.onCancel = () => done(null);
            const box = new FaceBox(duel, (str: string) => theme.fg("accent", str));
            return {
              render: (w: number) => box.render(w),
              invalidate: () => box.invalidate(),
              handleInput: (data: string) => {
                duel.handleInput(data);
                tui.requestRender();
              },
              handleMouse: (event) => {
                // -1 por el borde superior de la caja
                const result = duel.handleMouse({ ...event, y: event.y - 1 });
                if (result) tui.requestRender();
                return result;
              },
            };
          },
          { overlay: true, overlayOptions: { anchor: "center", width: 76 } },
        );
        if (!pick) return; // esc sale
        profile = pick;
        frameIdx = 0;
        paint();
        requestRender();
        const faces = FACES[mode];
        const face = faces[frameIdx % faces.length] ?? faces[0]!;
        ctx.ui.notify(`Carita: perfil ${profile} · ${mode} ${face}`, "info");
        } finally {
          modalOpen = false;
        }
      }

      // Alt+c — libre en pi (ctrl+c es limpiar/salir, alt+c no está usado).
      pi.registerShortcut("alt+c", {
        description: "carita: duelo dcdev vs cubis, elegí perfil con flechas o mouse",
        handler: async (ctx) => {
          await showProfilePick(ctx);
    },
  });
}
