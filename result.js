document.addEventListener('DOMContentLoaded', () => {
    const transcriptContent = document.getElementById('transcript-content');
    const videoTitle = document.getElementById('video-title');
    const channelName = document.getElementById('channel-name');
    const videoViews = document.getElementById('video-views');
    const videoLikes = document.getElementById('video-likes');
    const videoEmbedContainer = document.getElementById('video-embed-container');
    const copyBtn = document.getElementById('copy-btn');
    const downloadBtn = document.getElementById('download-btn');

    // Retrieve data from localStorage
    const rawData = localStorage.getItem('ytExtractResult');
    const videoUrl = localStorage.getItem('ytExtractUrl');

    if (!rawData || !videoUrl) {
        // If no data, send back to home
        window.location.href = 'index.html';
        return;
    }
    // Extract video ID from URL
    function getYouTubeID(url) {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    }

    const videoId = getYouTubeID(videoUrl);

    try {
        const data = JSON.parse(rawData);

        // Embed the video 
        // Note: Playback on file:/// environments is generally restricted by YouTube as Error 153.
        if (videoId) {
            const originParam = window.location.protocol.startsWith('http') ? `&origin=${window.location.origin}` : '';
            videoEmbedContainer.innerHTML = `
                <iframe 
                    id="yt-player"
                    src="https://www.youtube.com/embed/${videoId}?rel=0&enablejsapi=1${originParam}" 
                    allowfullscreen 
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                    style="width: 100%; height: 100%; position: absolute; top: 0; left: 0; border: none; border-radius: 16px;">
                </iframe>
            `;
        } else {
            videoEmbedContainer.innerHTML = `<div style="padding: 2rem; text-align: center; color: var(--text-secondary); width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; position: absolute;">Invalid YouTube URL</div>`;
        }

        // We assume n8n might return data in different shapes. Try to parse it intelligently.
        let actualData = data;
        if (Array.isArray(data) && data.length > 0) {
            actualData = data[0];
        }

        // --- Smart Extraction Strategy for Unknown JSON schemas ---
        function findValueDeep(obj, prioritizeTerms, fallbackTerms, excludeTerms = []) {
            if (!obj || typeof obj !== 'object') return null;

            // Priority 1: Match strong terms (e.g. channelTitle)
            for (const key of Object.keys(obj)) {
                const lowerKey = key.toLowerCase();
                if (excludeTerms.some(term => lowerKey.includes(term))) continue;
                if (prioritizeTerms.some(term => lowerKey === term || lowerKey.includes(term))) {
                    if (typeof obj[key] === 'string' || typeof obj[key] === 'number') return obj[key];
                }
            }

            // Priority 2: Match fallback terms
            for (const key of Object.keys(obj)) {
                const lowerKey = key.toLowerCase();
                if (excludeTerms.some(term => lowerKey.includes(term))) continue;
                if (fallbackTerms.some(term => lowerKey.includes(term))) {
                    if (typeof obj[key] === 'string' || typeof obj[key] === 'number') return obj[key];
                }
            }

            // Go deeper
            for (const key of Object.keys(obj)) {
                if (typeof obj[key] === 'object') {
                    const result = findValueDeep(obj[key], prioritizeTerms, fallbackTerms, excludeTerms);
                    if (result !== null) return result;
                }
            }
            return null;
        }

        const foundTitle = findValueDeep(data, ['videotitle', 'video_title'], ['title', 'headline', 'name'], ['channel', 'author', 'playlist', 'url', 'id']);
        const foundChannel = findValueDeep(data, ['channelname', 'channeltitle', 'authorname', 'uploader'], ['channel', 'author', 'creator'], ['url', 'link', 'id', 'thumbnail', 'pic', 'image']);
        const foundViews = findValueDeep(data, ['viewcount', 'views'], ['view', 'viwes'], ['url', 'id']);
        const foundLikes = findValueDeep(data, ['likecount', 'likes'], ['like', 'thumbs'], ['url', 'id']);

        // Setup a resilient transcript finder that also captures arrays (findValueDeep ignores arrays)
        function findTranscriptData(obj) {
            if (!obj || typeof obj !== 'object') return null;
            // Check if root has a likely array
            const terms = ['transcript', 'text', 'content', 'caption', 'subtitles', 'segments'];
            for (const key of Object.keys(obj)) {
                if (terms.some(t => key.toLowerCase().includes(t))) {
                    if (Array.isArray(obj[key]) || typeof obj[key] === 'string') return obj[key];
                }
            }
            // Check if obj is an array itself
            if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === 'object') {
                if ('text' in obj[0] || 'start' in obj[0] || 'timestamp' in obj[0]) return obj;
            }
            // Deep search
            for (const key of Object.keys(obj)) {
                if (typeof obj[key] === 'object') {
                    const res = findTranscriptData(obj[key]);
                    if (res) return res;
                }
            }
            return null;
        }

        // Find transcript, preferring typical names, otherwise fallback to the whole object
        let transcriptData = null;
        if (typeof actualData === 'string') {
            transcriptData = actualData;
        } else {
            transcriptData = findTranscriptData(data) || findValueDeep(data, ['transcript', 'text', 'content', 'summary'], ['caption'], ['url']) || actualData;
        }

        // Fill Title and Channel
        videoTitle.textContent = foundTitle || 'Loading...';
        channelName.textContent = foundChannel || 'Loading...';

        // Always try to fetch true Title and Channel from YouTube oEmbed API to fix wrong caption names!
        if (videoId) {
            const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
            fetch(oembedUrl)
                .then(res => res.json())
                .then(oembedData => {
                    if (oembedData.title) {
                        videoTitle.textContent = oembedData.title;
                    }
                    if (oembedData.author_name) {
                        channelName.textContent = oembedData.author_name;
                    }
                })
                .catch(err => {
                    console.log('Could not fetch oEmbed data', err);
                    if (!foundTitle) videoTitle.textContent = 'YouTube Video';
                    if (!foundChannel) channelName.textContent = 'Unknown Channel';
                });
        }

        // Helper function to format large numbers like 1200000 -> 1.2M
        function formatCount(num) {
            if (num === null || num === undefined || num === '') return '--';
            const val = typeof num === 'string' ? parseFloat(num.replace(/,/g, '').replace(/[^\d.-]/g, '')) : num;
            if (isNaN(val)) return num;
            if (val >= 1000000) return (val / 1000000).toFixed(1) + 'M';
            if (val >= 1000) return (val / 1000).toFixed(1) + 'K';
            return val.toLocaleString();
        }

        // Fill Views and Likes
        if (foundViews && videoViews) videoViews.textContent = formatCount(foundViews);
        if (foundLikes && videoLikes) videoLikes.textContent = formatCount(foundLikes);

        // Helper to format any seconds or string time nicely
        function formatTimeDisplay(timeVal) {
            if (typeof timeVal === 'string' && timeVal.includes(':')) return timeVal;
            const totalSeconds = Math.floor(Number(timeVal));
            if (isNaN(totalSeconds)) return '00:00';
            const mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
            const secs = (totalSeconds % 60).toString().padStart(2, '0');
            return `${mins}:${secs}`;
        }

        // Fill Transcript
        let transcriptHTML = '';

        if (Array.isArray(transcriptData)) {
            // Handline array of objects {text, timestamp} etc
            transcriptHTML = transcriptData.map((item, index) => {
                const text = typeof item === 'object' ? (item.text || item.content || JSON.stringify(item)) : item;
                let rawTime = typeof item === 'object' ? (item.timestamp !== undefined ? item.timestamp : item.start) : undefined;
                if (rawTime === undefined) rawTime = index * 5; // fallback
                
                const formattedTime = formatTimeDisplay(rawTime);
                const dataTime = !isNaN(Number(rawTime)) ? Number(rawTime) : 0; // uses parseTime later if 0

                return `<div class="transcript-line transcript-seekable" data-start="${dataTime}" style="cursor: pointer;"><span class="timestamp">${formattedTime}</span> <p>${text}</p></div>`;
            }).join('');
        } else if (typeof transcriptData === 'string') {
            // Split huge block of text into sentences for a better UI look
            let sentences = transcriptData.match(/[^.!?]+[.!?]+/g);
            if (!sentences || sentences.length === 0) {
                sentences = transcriptData.split('\n').filter(p => p.trim() !== '');
            } else {
                sentences = sentences.map(s => s.trim()).filter(s => s !== '');
            }

            let currentTime = 0; // in seconds
            transcriptHTML = sentences.map((sentence) => {
                const mins = Math.floor(currentTime / 60).toString().padStart(2, '0');
                const secs = (currentTime % 60).toString().padStart(2, '0');
                const timeStr = `${mins}:${secs}`;
                const dataTime = currentTime;

                // roughly estimate 5 seconds per sentence
                currentTime += 5;

                return `<div class="transcript-line transcript-seekable" data-start="${dataTime}" style="cursor: pointer;"><span class="timestamp">${timeStr}</span> <p>${sentence}</p></div>`;
            }).join('');
        } else if (typeof transcriptData === 'object') {
            // Just stringify nicely, but handle gracefully if it's completely empty
            if (Object.keys(transcriptData).length === 0) {
                transcriptHTML = `
                <div class="transcript-line" style="border-left: 3px solid #ef4444; background: rgba(239, 68, 68, 0.1);">
                    <div style="width: 100%;">
                        <p style="color: #fca5a5; font-weight: 500; font-size: 1.1rem; margin-bottom: 0.8rem;">
                            <i class="fa-solid fa-triangle-exclamation"></i> n8n Automation Error: The webhook sent an empty response!
                        </p>
                        <p style="font-size: 0.95rem; line-height: 1.6; color: var(--text-secondary);">
                            <strong>Raw data received by website:</strong> <br>
                            <code style="background: rgba(0,0,0,0.3); padding: 5px 10px; border-radius: 6px; display: inline-block; margin: 5px 0 15px 0;">${rawData}</code><br>
                            If you see the data inside your n8n dashboard but not here, it means your final <strong>Webhook Response</strong> node in n8n is not configured to return the transcript data back to the website. Please fix your n8n workflow to output the correct data.
                        </p>
                    </div>
                </div>`;
            } else {
                transcriptHTML = `<div class="transcript-line"><span class="timestamp">00:00</span> <p>${JSON.stringify(transcriptData, null, 2)}</p></div>`;
            }
        } else {
            transcriptHTML = `<div class="transcript-line"><p>No transcript data found.</p></div>`;
        }

        transcriptContent.innerHTML = transcriptHTML || '<div class="transcript-line"><p>No transcript available.</p></div>';

    } catch (e) {
        console.error('Error parsing data:', e);
        transcriptContent.innerHTML = `<div class="transcript-line"><p>Error displaying data.</p></div>`;
    }

    // Include the copy text button logic
    copyBtn.addEventListener('click', () => {
        const textToCopy = Array.from(document.querySelectorAll('.transcript-line p'))
            .map(p => p.textContent.trim())
            .join(' ');

        navigator.clipboard.writeText(textToCopy).then(() => {
            const originalHTML = copyBtn.innerHTML;
            copyBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
            copyBtn.style.color = '#10b981'; // Success green
            copyBtn.style.borderColor = 'rgba(16, 185, 129, 0.3)';
            copyBtn.style.background = 'rgba(16, 185, 129, 0.1)';

            setTimeout(() => {
                copyBtn.innerHTML = originalHTML;
                copyBtn.style.color = '';
                copyBtn.style.borderColor = '';
                copyBtn.style.background = '';
            }, 2000);
        });
    });

    // Provide the download functionality
    downloadBtn.addEventListener('click', () => {
        const textToDownload = Array.from(document.querySelectorAll('.transcript-line'))
            .map(line => {
                const timeEl = line.querySelector('.timestamp');
                const pEl = line.querySelector('p');
                const time = timeEl ? timeEl.textContent : '';
                const text = pEl ? pEl.textContent.trim() : '';
                return time ? `[${time}] ${text}` : text;
            })
            .join('\n');

        const blob = new Blob([textToDownload], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');

        a.href = url;
        a.download = 'youtube-transcript.txt';
        document.body.appendChild(a);
        a.click();
        // Clean up
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    // YouTube Transcript Sync Logic
    if (videoId) {
        
        function parseTime(timeStr) {
            const parts = timeStr.split(':').map(Number);
            if (parts.length === 2) return parts[0] * 60 + parts[1];
            if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
            return 0;
        }

        let ytPlayer = null;
        let isPlayerInitialized = false;

        function initYTPlayer() {
            if (isPlayerInitialized) return;
            isPlayerInitialized = true;
            
            // Bind to the existing iframe
            ytPlayer = new YT.Player('yt-player', { events: {} });
            
            // Critical Fix for existing iframes: Reload the iframe src so YT.Player gets the 'ready' signal
            const iframe = document.getElementById('yt-player');
            if (iframe) {
                iframe.src = iframe.src;
            }
        }

        // Wait for YT API if the browser decides to load it
        function waitForYT() {
            if (typeof window.YT !== 'undefined' && window.YT.Player) {
                initYTPlayer();
            } else {
                setTimeout(waitForYT, 100); // Polling for the script
            }
        }
        
        const tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        const firstScriptTag = document.getElementsByTagName('script')[0] || document.body;
        if (firstScriptTag.parentNode) {
            firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        } else {
            document.body.appendChild(tag);
        }
        waitForYT();

        let lastTime = -1;
        let currentActiveLine = null;

        // System 1: Native PostMessage Listener (Bypasses adblockers breaking window.YT completely)
        window.addEventListener('message', (event) => {
            if (typeof event.origin === 'string' && !event.origin.includes("youtube.com") && !event.origin.includes("youtube-nocookie.com")) return;
            try {
                const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
                if (data && data.event === 'infoDelivery' && data.info && data.info.currentTime !== undefined) {
                    const ct = parseFloat(data.info.currentTime);
                    if (ct !== lastTime && ct > 0) {
                        lastTime = ct;
                        updateTranscript(ct);
                    }
                }
            } catch (e) {}
        });

        // Continuously send listening event to activate infoDelivery
        setInterval(() => {
            const iframe = document.getElementById('yt-player');
            if (iframe && iframe.contentWindow) {
                try {
                    iframe.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), 'https://www.youtube.com');
                } catch(e) {}
            }
        }, 1000);

        // System 2: Official YT.Player API polling fallback (if message API fails to respond)
        setInterval(() => {
            if (ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
                try {
                    const ct = ytPlayer.getCurrentTime();
                    if (ct !== lastTime && ct > 0) {
                        lastTime = ct;
                        updateTranscript(ct);
                    }
                } catch (e) {}
            }
        }, 500);

        // Allow clicking transcript lines to seek natively
        const transcriptLines = document.querySelectorAll('.transcript-seekable');
        transcriptLines.forEach(line => {
            line.addEventListener('click', () => {
                let startAttr = line.getAttribute('data-start');
                if (startAttr) {
                    if (parseFloat(startAttr) === 0) {
                        const timeEl = line.querySelector('.timestamp');
                        if (timeEl) startAttr = parseTime(timeEl.textContent.trim());
                    }
                    const seconds = parseFloat(startAttr);
                    
                    // Try official player
                    if (ytPlayer && typeof ytPlayer.seekTo === 'function') {
                        try {
                            ytPlayer.seekTo(seconds, true);
                            ytPlayer.playVideo();
                        } catch(e) {}
                    }

                    // Try native command
                    const iframe = document.getElementById('yt-player');
                    if (iframe && iframe.contentWindow) {
                        try {
                            iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [seconds, true] }), 'https://www.youtube.com');
                            iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), 'https://www.youtube.com');
                        } catch(e) {}
                    }
                }
            });
        });

        function updateTranscript(currentTime) {
            const lines = document.querySelectorAll('.transcript-line');

            let newlyActiveLine = null;

            lines.forEach((line) => {
                let lineTime = 0;
                const startAttr = line.getAttribute('data-start');
                if (startAttr) {
                    lineTime = parseFloat(startAttr);
                }
                
                // Fallback to text reading if no valid data source mapped
                if (lineTime === 0) {
                    const timeEl = line.querySelector('.timestamp');
                    if (timeEl) {
                        lineTime = parseTime(timeEl.textContent.trim());
                    }
                }
                
                if (currentTime >= lineTime) {
                    newlyActiveLine = line;
                }
            });

            if (newlyActiveLine && newlyActiveLine !== currentActiveLine) {
                if (currentActiveLine) {
                    currentActiveLine.classList.remove('active');
                }
                newlyActiveLine.classList.add('active');
                
                // Use a smoother custom scroll logic over scrollIntoView to avoid layout jumps
                const container = document.getElementById('transcript-content');
                if (container) {
                    const lineTop = newlyActiveLine.offsetTop;
                    // Offset relative to parent container
                    const topPos = lineTop - container.offsetTop;
                    const containerHalf = container.offsetHeight / 2;
                    container.scrollTo({ top: topPos - containerHalf, behavior: 'smooth' });
                }
                currentActiveLine = newlyActiveLine;
            }
        }
    }
});
