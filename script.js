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

bRange.addEventListener('input', () => bVal.textContent = bRange.value + '%');
qRange.addEventListener('input', () => qVal.textContent = qRange.value + '%');
volRange.addEventListener('input', () => volVal.textContent = volRange.value + '%');
speedRange.addEventListener('input', () => speedVal.textContent = speedRange.value + '%');
echoRange.addEventListener('input', () => echoVal.textContent = echoRange.value + '%');
trebleRange.addEventListener('input', () => trebleVal.textContent = trebleRange.value + '%');

audioFile.addEventListener('change', () => {
    const file = audioFile.files[0];
    if (!file) return;
    
    fileName.textContent = file.name;
    statusText.textContent = "Файл выбран. Настройте эффекты и взрывайте!";
    boostBtn.disabled = false;

    const reader = new FileReader();
    reader.onload = function(e) {
        fileArrayBuffer = e.target.result;
    };
    reader.readAsArrayBuffer(file);
});

boostBtn.addEventListener('click', async () => {
    if (!fileArrayBuffer) return;
    
    statusText.textContent = "Взрываем трек по фану...";
    boostBtn.disabled = true;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const mainCtx = new AudioContextClass();
    if (mainCtx.state === 'suspended') await mainCtx.resume();

    mainCtx.decodeAudioData(fileArrayBuffer.slice(0), async (originalBuffer) => {
        const bassPower = parseInt(bRange.value);
        const qualityPower = parseInt(qRange.value) / 100;
        const volumePower = parseInt(volRange.value) / 100;
        const speedPower = parseInt(speedRange.value) / 100;
        const echoPower = parseInt(echoRange.value) / 100;
        const treblePower = parseInt(trebleRange.value);

        // 100% УНИВЕРСАЛЬНОСТЬ: Скрипт сам замеряет родные каналы и частоту файла
        const numChannels = originalBuffer.numberOfChannels;
        const currentSampleRate = originalBuffer.sampleRate;
        const newLength = Math.floor(originalBuffer.length / speedPower);
        
        const offlineCtx = new OfflineAudioContext(numChannels, newLength, currentSampleRate);
        
        const source = offlineCtx.createBufferSource();
        source.buffer = originalBuffer;
        source.playbackRate.setValueAtTime(speedPower, 0);

        let lastNode = source;

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

        if (treblePower > 0) {
            const trebleFilter = offlineCtx.createBiquadFilter();
            trebleFilter.type = "highshelf";
            trebleFilter.frequency.setValueAtTime(4000, 0);
            trebleFilter.gain.setValueAtTime(treblePower / 4, 0);
            
            lastNode.connect(trebleFilter);
            lastNode = trebleFilter;
        }

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

        const finalBuffer = applyBitcrusher(renderedBuffer, qualityPower, 16);

        const wavBlob = bufferToWav(finalBuffer);
        player.src = URL.createObjectURL(wavBlob);
        player.style.display = "block";
        statusText.textContent = "Готово! Слушаем результат.";
        boostBtn.disabled = false;

    }, (err) => {
        statusText.textContent = "Ошибка обработки аудио.";
        boostBtn.disabled = false;
        mainCtx.close();
    });
});

function applyBitcrusher(buffer, quality, depth) {
    if (quality >= 1 && depth >= 16) return buffer;
    
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const bufferLength = buffer.length;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContextClass();
    const newBuffer = ctx.createBuffer(numChannels, bufferLength, sampleRate);
    ctx.close();

    const validQuality = Math.max(0.005, quality); 
    const step = Math.min(bufferLength, Math.max(1, Math.round(1 / validQuality)));

    for (let channel = 0; channel < numChannels; channel++) {
        const inputData = buffer.getChannelData(channel);
        const outputData = newBuffer.getChannelData(channel);
        let lastVal = 0;

        for (let i = 0; i < bufferLength; i++) {
            if (i % step === 0) {
                let sample = inputData[i];
                lastVal = isNaN(sample) ? 0 : sample;
            }
            outputData[i] = lastVal;
        }
    }
    return newBuffer;
}

function bufferToWav(buffer) {
    const chan = buffer.numberOfChannels;
    const bufferLength = buffer.length;
    const resLen = bufferLength * chan * 2 + 44; 
    const arr = new ArrayBuffer(resLen);
    const view = new DataView(arr);
    let pos = 0;
    
    const wStr = s => { for(let i=0;i<s.length;i++) view.setUint8(pos+i, s.charCodeAt(i)); pos+=s.length; };
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
