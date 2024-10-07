install:
	npm install
	pip install -r requirements.txt

test:
	npm test
	pytest

build:
	docker build -t sparc-framework .

deploy:
	docker-compose up -d
