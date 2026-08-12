const audioFile = document.getElementById('audioFile');
const fileName = document.getElementById('fileName');
const bRange = document.getElementById('bRange');
const bVal = document.getElementById('bVal');
const qRange = document.getElementById('qRange');
const qVal = document.getElementById('qVal');
const boostBtn = document.getElementById('boostBtn');
const statusText = document.getElementById('statusText');
const player = document.getElementById('player');

const volRange = document.getElementById('volRange');
const volVal = document.getElementById('volVal');
const speedRange = document.getElementById('speedRange');
const speedVal = document.getElementById('speedVal');
const echoRange = document.getElementById('echoRange');
const echoVal = document.getElementById('echoVal');
const trebleRange = document.getElementById('trebleRange');
const trebleVal = document.getElementById('trebleVal');

let fileArrayBuffer = null;
let lastLoadedFileName = "";
let searchInterval = null;

bRange.addEventListener('input', () => bVal.textContent = bRange.value + '%');
qRange.addEventListener('input', () => qVal.textContent = qRange.value + '%');
volRange.addEventListener('input', () => volVal.textContent = volRange.value + '%');
speedRange.addEventListener('input', () => speedVal.textContent = speedRange.value + '%');
echoRange.addEventListener('input', () => echoVal.textContent = echoRange.value + '%');
trebleRange.addEventListener('input', () => trebleVal.textContent = trebleRange.value + '%');

function processSelectedFile(filesList) {
    if (!filesList || filesList.length === 0) return;
    const file = filesList[0];
    if (!file || file.name === lastLoadedFileName) return;
    
    if (searchInterval) {
        clearInterval(searchInterval);
        searchInterval = null;
    }
    
    lastLoadedFileName = file.name;
    fileName.textContent = file.name;
    statusText.textContent = "Файл успешно перехвачен движком! Взрывайте!";
    boostBtn.disabled = false;

    const reader = new FileReader();
    reader.onload = function(e) {
        if (e.target && e.target.result) {
            fileArrayBuffer = e.target.result;
        }
    };
    reader.readAsArrayBuffer(file);
}

audioFile.addEventListener('change', (event) => {
    if (event.target && event.target.files) {
        processSelectedFile(event.target.files);
    }
});

searchInterval = setInterval(() => {
    if (audioFile && audioFile.files && audioFile.files.length > 0) {
        processSelectedFile(audioFile.files);
    }
}, 1000);

boostBtn.addEventListener('click', async () => {
    if (!fileArrayBuffer) return;
    
    statusText.textContent = "Взрываем длинный трек... Пожалуйста, подождите пару секунд...";
    boostBtn.disabled = true;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const mainCtx = new AudioContextClass();
    if (mainCtx.state === 'suspended') await mainCtx.resume();

    const bufferCopy = fileArrayBuffer.slice(0);

    mainCtx.decodeAudioData(bufferCopy, async (originalBuffer) => {
        const bassPower = parseInt(bRange.value);
        const qualityPower = parseInt(qRange.value) / 100;
        const volumePower = parseInt(volRange.value) / 100;
        const speedPower = parseInt(speedRange.value) / 100;
        const echoPower = parseInt(echoRange.value) / 100;
        const treblePower = parseInt(trebleRange.value);

        const numChannels = originalBuffer.numberOfChannels;
        const currentSampleRate = originalBuffer.sampleRate;
        const newLength = Math.floor(originalBuffer.length / speedPower);
        
        const offlineCtx = new OfflineAudioContext(numChannels, newLength, currentSampleRate);
        
        const source = offlineCtx.createBufferSource();
        source.buffer = originalBuffer;
        source.playbackRate.setValueAtTime(speedPower, 0);

        let lastNode = source;

        // ЭФФЕКТ 1: Мощный Бас
        if (bassPower > 100) {
            const gain = (bassPower - 100) / 12; 
            
            const filter = offlineCtx.createBiquadFilter();
            filter.type = "peaking"; 
            filter.frequency.setValueAtTime(90, 0); 
            filter.Q.setValueAtTime(2.5, 0); 
            filter.gain.setValueAtTime(gain * 1.3, 0);

            const filter2 = offlineCtx.createBiquadFilter();
            filter2.type = "lowshelf";
            filter2.frequency.setValueAtTime(50, 0); 
            filter2.gain.setValueAtTime(gain * 0.4, 0);

            const shaper = offlineCtx.createWaveShaper();
            const curve = new Float32Array(44100);
            for (let i = 0; i < 44100; ++i) {
                let x = (i * 2) / 44100 - 1;
                curve[i] = Math.tanh(x * (1 + gain * 0.5)); 
            }
            shaper.curve = curve;

            lastNode.connect(filter);
            filter.connect(filter2);
            filter2.connect(shaper);
            lastNode = shaper;
        }

        // ЭФФЕКТ 2: Высокие частоты
        if (treblePower > 0) {
            const trebleFilter = offlineCtx.createBiquadFilter();
            trebleFilter.type = "highshelf";
            trebleFilter.frequency.setValueAtTime(4000, 0);
            trebleFilter.gain.setValueAtTime(treblePower / 4, 0);
            
            lastNode.connect(trebleFilter);
            lastNode = trebleFilter;
        }

        // ЭФФЕКТ 3: Качество звука (Ультра-быстрый встроенный Bitcrusher без зависаний лонгов)
        if (qualityPower < 1) {
            const crusherNode = offlineCtx.createWaveShaper();
            const samples = 44100;
            const curve = new Float32Array(samples);
            const bits = Math.round(1 + qualityPower * 7); // от 1 до 8 бит
            const steps = Math.pow(2, bits);
            for (let i = 0; i < samples; i++) {
                let x = (i * 2) / samples - 1;
                curve[i] = Math.round(x * steps) / steps;
            }
            crusherNode.curve = curve;
            lastNode.connect(crusherNode);
            lastNode = crusherNode;
        }

        // ЭФФЕКТ 4: Эхо
        if (echoPower > 0) {
            const delay = offlineCtx.createDelay();
            delay.delayTime.setValueAtTime(0.3, 0);

            const feedback = offlineCtx.createGain();
            feedback.gain.setValueAtTime(echoPower * 0.6, 0);

            lastNode.connect(delay);
            delay.connect(feedback);
            feedback.connect(delay);

            const echoMix = offlineCtx.createGain();
            echoMix.gain.setValueAtTime(echoPower, 0);
            delay.connect(echoMix);

            const merger = offlineCtx.createGain();
            lastNode.connect(merger);
            echoMix.connect(merger);
            lastNode = merger;
        }

        // Регулировка общей громкости
        const gainNode = offlineCtx.createGain();
        gainNode.gain.setValueAtTime(volumePower, 0);
        lastNode.connect(gainNode);
        lastNode = gainNode;

        const highPass = offlineCtx.createBiquadFilter();
        highPass.type = "highpass";
        highPass.frequency.setValueAtTime(15, 0);
        
        const compressor = offlineCtx.createDynamicsCompressor();
        compressor.threshold.setValueAtTime(-8, 0);
        compressor.ratio.setValueAtTime(8, 0);

        lastNode.connect(highPass);
        highPass.connect(compressor);
        compressor.connect(offlineCtx.destination);
        
        source.start(0);

        const renderedBuffer = await offlineCtx.startRendering();
        mainCtx.close();

        const wavBlob = bufferToWav(renderedBuffer);
        
        player.src = URL.createObjectURL(wavBlob);
        player.style.display = "block";
        statusText.textContent = "Готово! Слушаем результат.";
        boostBtn.disabled = false;

        searchInterval = setInterval(() => {
            if (audioFile && audioFile.files && audioFile.files.length > 0) {
                processSelectedFile(audioFile.files);
            }
        }, 1000);

    }, (err) => {
        statusText.textContent = "Ошибка обработки аудио.";
        boostBtn.disabled = false;
        mainCtx.close();
    });
});

function bufferToWav(buffer) {
    const chan = buffer.numberOfChannels;
    const bufferLength = buffer.length;
    const resLen = bufferLength * chan * 2 + 44; 
    const arr = new ArrayBuffer(resLen);
    const view = new DataView(arr);
    let pos = 0;
    
    const wStr = s => { for(let i=0; i<s.length; i++) view.setUint8(pos+i, s.charCodeAt(i)); pos+=s.length; };
    const w16 = d => { view.setUint16(pos, d, true); pos+=2; };
    const w32 = d => { view.setUint32(pos, d, true); pos+=4; };
    
    wStr('RIFF'); w32(resLen-8); wStr('WAVE'); wStr('fmt '); w32(16); w16(1); w16(chan); w32(buffer.sampleRate);
    w32(buffer.sampleRate*chan*2); w16(chan*2); w16(16); wStr('data'); w32(bufferLength*chan*2);
    
    for(let o=0; o<bufferLength; o++) {
        for(let c=0; c<chan; c++) {
            let s = buffer.getChannelData(c)[o];
            s = s>1?1:s<-1?-1:s;
            view.setInt16(pos, s<0?s*0x8000:s*0x7FFF, true); pos+=2;
        }
    }
    return new Blob([arr], {type:'audio/wav'});
}
