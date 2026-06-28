const fs = require('fs');
const { execSync } = require('child_process');

const rawDir = './raw_audio';
const outDir = './wavs';

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

const files = fs.readdirSync(rawDir);

files.forEach(file => {
    const match = file.match(/interview recording (\d+)\.(.+)/i);
    if (match) {
        const oldNum = parseInt(match[1]);
        const newNum = oldNum - 3; 
        
        if (newNum >= 1 && newNum <= 50) {
            const inputFile = `${rawDir}/${file}`;
            const outputFile = `${outDir}/${newNum}.wav`;
            
            console.log(`Converting recording ${oldNum} -> ${newNum}.wav...`);
            
            execSync(`ffmpeg -i "${inputFile}" -ar 22050 -ac 1 -c:a pcm_s16le "${outputFile}" -y`);
        }
    }
});
console.log("Dataset formatting complete. Ready for Colab!");
