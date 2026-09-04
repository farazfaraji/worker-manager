# Run Webserver Block Documentation & Usage Guide

The **Run Webserver** block hosts an embedded HTTP service directly from your flow board. It listens on a user-specified port, tracks server health status, and automatically attaches to all **Route** blocks present on the same board to serve incoming web requests.

---

## 1. Overview & Architecture

- **Background Daemon**: The webserver operates as a continuous background listener, surviving individual flow run executions until stopped.
- **Board-Level Route Binding**: Any `route` block on the same board is automatically mounted onto this server's endpoint router.
- **Port Management**: If the designated port is already occupied, the server reports an error and prevents accidental port collisions.
- **Interactive Node Card**: Directly toggle the server **Start** and **Stop** states from the canvas node card or via API.

```mermaid
graph TD
    Client[External Client / Frontend] -->|HTTP Request| Server[Run Webserver (Port X)]
    Server --> Route1[Route /api/users]
    Server --> Route2[Route /webhook/stripe]
    Route1 --> Downstream1[Flow Logic & Processing]
    Route2 --> Downstream2[Flow Logic & Processing]
```

---

## 2. Node Inputs & Configuration

| Field | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `port` | `text` / `number` | Yes | `3000` | Port number to bind and listen on (e.g. `3000`, `8080`). |
| `host` | `text` | No | `"0.0.0.0"` | Network interface host address. |
| `cors` | `select` | No | `"enabled"` | Enables `Access-Control-Allow-*` headers for cross-origin browser clients. |

---

## 3. Node Outputs

| Output Name | Type | Description |
| :--- | :--- | :--- |
| `server` | `object` | Contains server status (`running` / `stopped`), active `port`, and host URL. |

---

## 4. API Management

The webserver service exposes management endpoints:

- **Start Webserver**: `POST /api/webservers/:graphId/start`
- **Stop Webserver**: `POST /api/webservers/:graphId/stop`
- **Status Check**: `GET /api/webservers/:graphId/status`
