/* Google API & Identity Services type stubs */
declare namespace gapi {
  function load(api: string, options: { callback: () => void; onerror?: () => void }): void;
  namespace client {
    function init(config: {
      apiKey?: string;
      discoveryDocs?: string[];
    }): Promise<void>;
    function getToken(): { access_token: string } | null;
    namespace tasks {
      namespace tasklists {
        function list(): Promise<{
          result: { items?: Array<{ id?: string; title?: string }> };
        }>;
        function insert(params: {
          resource: { title: string };
        }): Promise<{ result: { id?: string } }>;
      }
      namespace tasks {
        function list(params: {
          tasklist: string;
          showCompleted?: boolean;
          showHidden?: boolean;
          maxResults?: number;
        }): Promise<{ result: { items?: Array<Record<string, unknown>> } }>;
        function insert(params: {
          tasklist: string;
          resource: Record<string, unknown>;
        }): Promise<{ result: { id?: string } }>;
        function update(params: {
          tasklist: string;
          task: string;
          resource: Record<string, unknown>;
        }): Promise<{ result: { id?: string } }>;
        function delete_(params: {
          tasklist: string;
          task: string;
        }): Promise<void>;
      }
    }
  }
}

declare namespace google {
  namespace accounts {
    namespace oauth2 {
      interface TokenResponse {
        access_token: string;
        error?: string;
      }
      interface TokenClient {
        callback: (resp: TokenResponse) => void;
        requestAccessToken(opts?: { prompt?: string }): void;
      }
      function initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (resp: TokenResponse) => void;
      }): TokenClient;
    }
  }
}
