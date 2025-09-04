# Etapa 1: Usar uma imagem base oficial do Node.js
FROM node:18-bullseye-slim

# Define o diretório de trabalho dentro do contêiner
WORKDIR /app

# Copia o package.json e o package-lock.json
# As dependências de sistema serão instaladas pelo nixpacks.toml
COPY package*.json ./

# Instala as dependências do Node.js
RUN npm install

# Copia todos os outros ficheiros da sua aplicação
COPY . .

# Expõe a porta que a sua aplicação usa
EXPOSE 8000

# O comando para iniciar a sua aplicação (também definido no nixpacks.toml como garantia)
CMD [ "node", "botzdg.js" ]