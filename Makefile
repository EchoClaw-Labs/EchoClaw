# EchoClaw CLI — Developer Makefile

.PHONY: build test dev clean agent-up agent-down agent-status agent-logs agent-reset

# -- Build & Test -------------------------------------------------------------

build:
	pnpm run build

test:
	pnpm test

dev:
	pnpm run dev

clean:
	pnpm run clean

# -- Echo Agent Docker --------------------------------------------------------

COMPOSE := docker compose -f docker/echo-agent/docker-compose.yml -p echo-agent
LOCAL_COMPOSE := docker compose -f docker/echo-agent/docker-compose.yml -f docker/echo-agent/docker-compose.build.yml -p echo-agent
CONFIG_DIR := $(shell node -e "const os=require('node:os'); const path=require('node:path'); const plat=os.platform(); let dir=''; if (plat==='win32') { const appData=process.env.APPDATA ?? path.join(os.homedir(),'AppData','Roaming'); dir=path.join(appData,'echoclaw'); } else if (plat==='darwin') { dir=path.join(os.homedir(),'Library','Application Support','echoclaw'); } else { const xdg=process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(),'.config'); dir=path.join(xdg,'echoclaw'); } process.stdout.write(dir);")
AGENT_IMAGE := echo-agent-agent:dev

agent-up:
	ECHO_CONFIG_DIR="$(CONFIG_DIR)" ECHO_AGENT_IMAGE=$(AGENT_IMAGE) $(LOCAL_COMPOSE) up -d --build

agent-down:
	$(COMPOSE) down

agent-status:
	$(COMPOSE) ps

agent-logs:
	$(COMPOSE) logs -f agent

agent-reset:
	$(COMPOSE) down -v

# -- Run agent from local dist -----------------------------------------------

agent-start:
	node dist/cli.js echo agent start

agent-stop:
	node dist/cli.js echo agent stop

agent-backup:
	node dist/cli.js echo agent backup --json

# -- Shortcuts ----------------------------------------------------------------

lint:
	pnpm exec tsc --noEmit

check: lint test
