cd /Users/bilgebalga/Desktop/Demo_Projects/qr-menu
npm install
npm run dev -- --hostname 0.0.0.0 --port 3000


cd /Users/bilgebalga/Desktop/Demo_Projects/qr-menu
npm run dev -- --hostname 0.0.0.0 --port 3001

http://localhost:3000
http://localhost:3001


Eğer çalışmazsa
lsof -ti :3000,3001 | xargs -r kill -9

sonra tekrar: 
cd /Users/bilgebalga/Desktop/Demo_Projects/qr-menu
npm run dev -- --hostname 0.0.0.0 --port 3000