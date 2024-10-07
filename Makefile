install:
	./install.sh

test:
	poetry run pytest
	npm test

build:
	docker build -t sparc-framework .

deploy:
	docker-compose up -d
