// Tipos compartilhados pelos arquivos vanilla com JSDoc.
// NÃO É código runtime — só ambient declarations pro tsc --checkJs.
declare global {
  interface Window {
    Modules: Record<string, any>;
    DB: any;
    Utils: any;
    Policies: any;
    Validators: any;
    Schemas: any;
    Errors: any;
    AppErrors: any;
    Logger: any;
    Config: any;
    Events: any;
    Sentry?: any;
    currentUser?: { id: string; email?: string; [k: string]: any } | null;
    _lastFocus?: Element | null;
    ERR?: Record<string, string>;
  }
  // Globals que modules/ usam via shared script scope.
  var currentUser: Window['currentUser'];
  var getSupabase: () => any;
  var fetchPublicProfiles: (sb: any, ids: string[], cols?: string) => Promise<any[]>;
  var reportError: (payload: any) => void;
  var parseBRL: (val: unknown) => number;
  var dateBR: (s: string) => string;
  var Modules: Window['Modules'];
  var DB: Window['DB'];
  var Utils: Window['Utils'];
  var Policies: Window['Policies'];
  var Schemas: Window['Schemas'];
  var Events: Window['Events'];
  var AppErrors: Window['AppErrors'];
  var Logger: Window['Logger'];
  var Config: Window['Config'];
}
export {};
