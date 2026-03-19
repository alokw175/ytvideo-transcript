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

    try {
        const data = JSON.parse(rawData);
        
        // Extract video ID from URL
        function getYouTubeID(url) {
            const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
            const match = url.match(regExp);
            return (match && match[2].length === 11) ? match[2] : null;
        }

        const videoId = getYouTubeID(videoUrl);
        
        // Embed the video 
        // Note: Playback on file:/// environments is generally restricted by YouTube as Error 153.
        if (videoId) {
            videoEmbedContainer.innerHTML = `
                <iframe 
                    id="yt-player"
                    src="https://www.youtube.com/embed/${videoId}?rel=0&enablejsapi=1" 
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
        
        // Find transcript, preferring typical names, otherwise fallback to the whole object
        let transcriptData = null;
        if (typeof actualData === 'string') {
            transcriptData = actualData;
        } else {
            transcriptData = findValueDeep(data, ['transcript', 'text', 'content', 'summary'], ['caption'], ['url']) || actualData;
        }

        // Fill Title and Channel
        videoTitle.textContent = foundTitle || 'Loading...';
        channelName.textContent = foundChannel || 'Loading...';

        // If automation didn't send Title or Channel, fetch them directly from YouTube oEmbed API!
        if ((!foundTitle || !foundChannel) && videoId) {
            const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
            fetch(oembedUrl)
                .then(res => res.json())
                .then(oembedData => {
                    if (!foundTitle && oembedData.title) {
                        videoTitle.textContent = oembedData.title;
                    }
                    if (!foundChannel && oembedData.author_name) {
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

        // Fill Transcript
        let transcriptHTML = '';

        if (Array.isArray(transcriptData)) {
            // Handline array of objects {text, timestamp} etc
            transcriptHTML = transcriptData.map((item, index) => {
                const text = typeof item === 'object' ? (item.text || item.content || JSON.stringify(item)) : item;
                const time = typeof item === 'object' ? (item.timestamp || item.start || `00:${String(index).padStart(2, '0')}`) : '00:00';
                return `<div class="transcript-line"><span class="timestamp">${time}</span> <p>${text}</p></div>`;
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
                
                // roughly estimate 5 seconds per sentence
                currentTime += 5; 
                
                return `<div class="transcript-line"><span class="timestamp">${timeStr}</span> <p>${sentence}</p></div>`;
            }).join('');
        } else if (typeof transcriptData === 'object') {
             // Just stringify nicely
             transcriptHTML = `<div class="transcript-line"><span class="timestamp">00:00</span> <p>${JSON.stringify(transcriptData, null, 2)}</p></div>`;
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
        window.onYouTubeIframeAPIReady = function() {
            new YT.Player('yt-player', {
                events: {
                    'onStateChange': onPlayerStateChange
                }
            });
        };

        const tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        
        let syncInterval;
        let currentActiveLine = null;

        function onPlayerStateChange(event) {
            if (event.data == YT.PlayerState.PLAYING) {
                syncInterval = setInterval(() => updateTranscript(event.target), 500);
            } else {
                clearInterval(syncInterval);
            }
        }

        function parseTime(timeStr) {
            const parts = timeStr.split(':').map(Number);
            if (parts.length === 2) return parts[0] * 60 + parts[1];
            if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
            return 0;
        }

        function updateTranscript(player) {
            const currentTime = player.getCurrentTime();
            const lines = document.querySelectorAll('.transcript-line');
            
            let newlyActiveLine = null;
            
            lines.forEach((line) => {
                const timeEl = line.querySelector('.timestamp');
                if (!timeEl) return;
                const lineTime = parseTime(timeEl.textContent.trim());
                if (currentTime >= lineTime) {
                    newlyActiveLine = line;
                }
            });
            
            if (newlyActiveLine && newlyActiveLine !== currentActiveLine) {
                if (currentActiveLine) {
                    currentActiveLine.classList.remove('active');
                }
                newlyActiveLine.classList.add('active');
                newlyActiveLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
                currentActiveLine = newlyActiveLine;
            }
        }
    }
});
