// ==========================================
// МУЗЫКАЛЬНЫЙ ПЛЕЕР
// ==========================================

export async function changeMusicService(service) {
    const container = document.getElementById('musicPlayerContainer');
    if (!container) return;
    
    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ musicService: service })
        });
    } catch (error) {
        console.error('Ошибка сохранения музыкального сервиса:', error);
    }
    
    if (service === 'spotify') {
        container.innerHTML = `
            <div class="bg-gray-700 rounded-lg p-4 mb-4">
                <p class="text-sm text-gray-400 mb-2">Для работы Spotify необходимо авторизоваться в аккаунте</p>
                <p class="text-sm text-gray-400 mb-4">Откройте Spotify в отдельной вкладке или используйте приложение</p>
                <a href="https://open.spotify.com" target="_blank" 
                   class="inline-block px-6 py-3 bg-green-600 hover:bg-green-700 rounded-lg font-medium transition-colors">
                    Открыть Spotify
                </a>
            </div>
            <iframe src="https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M" 
                    width="100%" height="352" frameBorder="0" 
                    allowtransparency="true" allow="encrypted-media"
                    class="rounded-lg"></iframe>
        `;
    } else if (service === 'youtube') {
        container.innerHTML = `
            <div class="bg-gray-700 rounded-lg p-4 mb-4">
                <p class="text-sm text-gray-400 mb-2">Для работы YouTube Music необходимо авторизоваться в аккаунте</p>
                <p class="text-sm text-gray-400 mb-4">Откройте YouTube Music в отдельной вкладке или используйте приложение</p>
                <a href="https://music.youtube.com" target="_blank" 
                   class="inline-block px-6 py-3 bg-red-600 hover:bg-red-700 rounded-lg font-medium transition-colors">
                    Открыть YouTube Music
                </a>
            </div>
            <iframe src="https://music.youtube.com/embed" 
                    width="100%" height="352" frameBorder="0" 
                    allowtransparency="true" allow="encrypted-media"
                    class="rounded-lg"></iframe>
        `;
    }
}

// Делаем функцию доступной глобально
if (typeof window !== 'undefined') {
    window.changeMusicService = changeMusicService;
}

