# todo

This project uses Docker to build and run a Node.js backend and React frontend.
Both services are defined in `docker-compose.yml` along with a PostgreSQL
database.

The app stores tasks in a PostgreSQL database and exposes a small REST API.
The React frontend is served as a Progressive Web App so it can be installed on
desktop or mobile devices.

To start the environment run:

```sh
docker compose up --build
```

This command builds the images and launches the web server container together
with PostgreSQL.

Once the containers are running, check the container logs. The server prints the
URL where the app is available. In most setups this is
`http://localhost:3000`, but in environments like Codespaces or Gitpod the log
will show the full forwarded URL.
