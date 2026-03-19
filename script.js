document.addEventListener('DOMContentLoaded', () => {
    const extractBtn = document.getElementById('extract-btn');
    const videoUrlInput = document.getElementById('video-url');
    const loadingSection = document.getElementById('loading');

    // Send data to webhook process
    extractBtn.addEventListener('click', async () => {
        const url = videoUrlInput.value.trim();
        if (!url) {
            alert('Please enter a valid YouTube URL');
            videoUrlInput.focus();
            return;
        }

        // Show loading
        loadingSection.classList.remove('hidden');

        try {
            // Send the YouTube URL to the n8n webhook
            const response = await fetch('https://n8n.srv1046180.hstgr.cloud/webhook/5701c964-c58e-48a4-af5f-ae56323a227b', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ videoUrl: url })
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Server error (${response.status}): ${errText}`);
            }
            
            const rawText = await response.text();
            let data;
            try {
                // n8n testing webhooks might return arrays or empty strings
                data = rawText ? JSON.parse(rawText) : {};
            } catch (e) {
                // If it's just raw text, we still want to show it on the result page
                data = { transcript: rawText };
            }
            
            // Save data to localStorage to display on the next page
            localStorage.setItem('ytExtractResult', JSON.stringify(data));
            localStorage.setItem('ytExtractUrl', url);

            // Redirect to results page
            window.location.href = 'result.html';

        } catch (error) {
            console.error('Webhook Error:', error);
            // Show exact error message to help debug whether it's CORS, 404, or URL issues
            alert(`Error: ${error.message}\n\nPlease check if your n8n workflow is active, or if you need to change 'webhook-test' to 'webhook'.`);
            loadingSection.classList.add('hidden');
        }
    });

    // Enter key support
    videoUrlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            extractBtn.click();
        }
    });

});
