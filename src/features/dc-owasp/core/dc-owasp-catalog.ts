/**
 * dc-owasp-catalog.ts — Catálogo curado de Cheat Sheets críticas de OWASP
 * con mapeo de categorías, nombres de archivo y URLs oficiales.
 */

export interface OwaspCatalogItem {
  id: string;
  title: string;
  category: string;
  filename: string;
  url: string;
  keywords: string[];
}

export const OWASP_CATALOG: OwaspCatalogItem[] = [
  {
    id: "auth",
    title: "Authentication Cheat Sheet",
    category: "Authentication & Access Control",
    filename: "Authentication_Cheat_Sheet.md",
    url: "https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html",
    keywords: ["auth", "login", "password", "session", "mfa", "credential", "lockout", "brute-force"],
  },
  {
    id: "authorization",
    title: "Authorization Cheat Sheet",
    category: "Authentication & Access Control",
    filename: "Authorization_Cheat_Sheet.md",
    url: "https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html",
    keywords: ["rbac", "abac", "permission", "role", "access control", "idor", "privilege"],
  },
  {
    id: "session",
    title: "Session Management Cheat Sheet",
    category: "Authentication & Access Control",
    filename: "Session_Management_Cheat_Sheet.md",
    url: "https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html",
    keywords: ["cookie", "session", "httponly", "samesite", "secure", "token", "timeout"],
  },
  {
    id: "jwt",
    title: "JSON Web Token for Java and Other Cheat Sheet",
    category: "Authentication & Access Control",
    filename: "JSON_Web_Token_for_Java_Cheat_Sheet.md",
    url: "https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html",
    keywords: ["jwt", "token", "hs256", "rs256", "none algorithm", "jws", "signature", "secret"],
  },
  {
    id: "sql-injection",
    title: "SQL Injection Prevention Cheat Sheet",
    category: "Injection Prevention",
    filename: "SQL_Injection_Prevention_Cheat_Sheet.md",
    url: "https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html",
    keywords: ["sql", "sqli", "prepared statement", "parameterized", "orm", "database", "query"],
  },
  {
    id: "xss",
    title: "Cross Site Scripting Prevention Cheat Sheet",
    category: "Injection Prevention",
    filename: "Cross_Site_Scripting_Prevention_Cheat_Sheet.md",
    url: "https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html",
    keywords: ["xss", "cross-site scripting", "innerhtml", "dom", "escaping", "encode", "sanitization"],
  },
  {
    id: "csrf",
    title: "Cross-Site Request Forgery Prevention Cheat Sheet",
    category: "Web & API Security",
    filename: "Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.md",
    url: "https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html",
    keywords: ["csrf", "xsrf", "samesite", "anti-csrf", "state-changing", "cookie"],
  },
  {
    id: "cors",
    title: "Cross-Origin Resource Sharing Cheat Sheet",
    category: "Web & API Security",
    filename: "Cross-Origin_Resource_Sharing_Cheat_Sheet.md",
    url: "https://cheatsheetseries.owasp.org/cheatsheets/Cross-Origin_Resource_Sharing_Cheat_Sheet.html",
    keywords: ["cors", "origin", "access-control-allow-origin", "credentials", "preflight", "options"],
  },
  {
    id: "rest-api",
    title: "REST Security Cheat Sheet",
    category: "Web & API Security",
    filename: "REST_Security_Cheat_Sheet.md",
    url: "https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html",
    keywords: ["rest", "api", "json", "rate-limit", "endpoints", "verbs", "http"],
  },
  {
    id: "crypto",
    title: "Cryptographic Storage Cheat Sheet",
    category: "Data Protection",
    filename: "Cryptographic_Storage_Cheat_Sheet.md",
    url: "https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html",
    keywords: ["crypto", "encryption", "aes-gcm", "hash", "salt", "argon2", "bcrypt", "sha256"],
  },
  {
    id: "file-upload",
    title: "File Upload Cheat Sheet",
    category: "Input Handling",
    filename: "File_Upload_Cheat_Sheet.md",
    url: "https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html",
    keywords: ["file upload", "multipart", "extension", "mime-type", "svg", "rce", "traversal"],
  },
  {
    id: "docker",
    title: "Docker Security Cheat Sheet",
    category: "Operations & Cloud",
    filename: "Docker_Security_Cheat_Sheet.md",
    url: "https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html",
    keywords: ["docker", "container", "root", "user", "dockerfile", "capabilities", "cgroups"],
  },
];
