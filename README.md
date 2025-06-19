# todo

This is a simple **Todo List** application containerized with Docker:

- **Backend**: Node.js + Express  
- **Frontend**: React served as a Progressive Web App (PWA)  
- **Database**: PostgreSQL  

The app exposes a REST API for managing tasks and serves a React PWA that can be installed on desktop or mobile devices.

## 🚀 Quick Start

```sh
docker compose up --build -d
```

- Builds the images  
- Starts PostgreSQL with persistent storage  
- Starts the web server (API + PWA)  

## 🔗 Access the App

By default, open:

```
http://localhost:3051
```

In environments like Codespaces, Gitpod, or on your VPS with HTTPS, check the **web** container logs. Look for:

```
Server running at https://3051-your-environment-url
Open https://3051-your-environment-url in your browser.
```

## 📦 Project Structure

- `public/` — static files (HTML, manifest.json, icons, service-worker.js)  
- `app.js` — React frontend code  
- `server.js` — Express backend  
- `.env` — database credentials and external port  
- `docker-compose.yml` — service definitions  
- `Dockerfile` — builds combined backend + frontend image  

## 📱 Installing as a PWA

The app includes `manifest.json` and `service-worker.js`. Browsers will show an **Install app** option when:

- Served over **HTTPS** (or `localhost`)  
- The PWA criteria are met  

Make sure your VPS has SSL (e.g., Let’s Encrypt).

## ⚠️ Note on Development

This project was initially generated with **OpenAI Codex**. Due to its limitations and hallucinations, significant manual restructuring was required to:

- Unify client and server folders  
- Configure Docker volumes and health checks  
- Ensure real PWA compatibility  
