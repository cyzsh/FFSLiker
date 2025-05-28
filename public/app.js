// Wait for all assets to load
window.addEventListener('load', function() {
  // Fade out loading overlay
  const loadingOverlay = document.getElementById('loadingOverlay');
  const appElement = document.getElementById('app');
  
  setTimeout(() => {
    loadingOverlay.style.opacity = '0';
    appElement.style.opacity = '1';
    
    // Remove loading overlay from DOM after fade out
    setTimeout(() => {
      loadingOverlay.style.display = 'none';
    }, 500);
  }, 1000); // Minimum 1 second loading time for better UX
});

// Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => console.log('SW registered:', registration))
      .catch(error => console.log('SW registration failed:', error));
  });
}

window.addEventListener('error', (event) => {
  console.error('Global error:', event.error || event.message, 
               'at', event.filename, 
               'line', event.lineno);
});

// Vue Application
const { createApp, ref, onMounted } = Vue;

createApp({
  setup() {
    const currentPage = ref('login');
    const loadingStates = ref({
      login: false,
      follow: false,
      reactions: false,
      share: false,
      guardOn: false,
      guardOff: false,
      sessionCheck: true
    });
    
    const user = ref({
      id: '',
      name: '',
      token: '',
      cookies: '',
      sessionToken: ''
    });
    
    const cooldownTime = ref(0);
    
    const loginForm = ref({
      username: '',
      password: ''
    });
    
    const followForm = ref({
      link: '',
      limit: '5'
    });
    
    const reactionForm = ref({
      link: '',
      type: 'WOW',
      limit: '5'
    });
    
    const shareForm = ref({
      link: '',
      delay: '5',
      limit: '100'
    });
    
    // Check session on app load
    const checkSession = async () => {
      try {
        // Check if we have a session token in localStorage
        const encryptedToken = localStorage.getItem('sessionToken');
        if (encryptedToken) {
          const response = await axios.get('/api/session', {
            headers: {
              'Authorization': `Bearer ${encryptedToken}`
            }
          });
          
          if (response.data.success) {
            user.value = response.data.user;
            currentPage.value = 'dashboard';
          } else {
            localStorage.removeItem('sessionToken');
          }
        }
      } catch (error) {
        console.error('Session check error:', error);
        localStorage.removeItem('sessionToken');
      } finally {
        loadingStates.value.sessionCheck = false;
      }
    };
    
    // Cooldown Message
    const getCooldownMessage = () => {
      const tool = localStorage.getItem('cooldownTool');
      const baseMsg = `Please wait for ${cooldownTime.value} minutes before submitting again.`;
      
      if (tool === 'follow') {
        return `Auto Follower tool is cooling down. ${baseMsg}`;
      } else if (tool === 'reactions') {
        return `Auto Reactions tool is cooling down. ${baseMsg}`;
      }
      return baseMsg;
    };
    
    // Initialize the app
    onMounted(() => {
      checkSession();
    });
    
    const handleLogin = async () => {
      try {
        loadingStates.value.login = true;
        
        const response = await axios.post('/api/login', {
          email: loginForm.value.username,
          password: loginForm.value.password
        });
        
        if (response.data.success) {
          user.value = {
            id: response.data.userId,
            name: response.data.name || 'Facebook User',
            token: response.data.accessToken,
            cookies: response.data.cookies || '',
            sessionToken: response.data.sessionToken
          };
          
          // Store the encrypted session token
          localStorage.setItem('sessionToken', response.data.sessionToken);
          
          currentPage.value = 'dashboard';
          
          Swal.fire({
            title: 'Success',
            text: 'Logged in successfully!',
            icon: 'success',
            background: '#1e293b',
            color: '#ffffff'
          });
        } else {
          throw new Error(response.data.error || 'Login failed');
        }
      } catch (error) {
        console.error('Login error:', error);
        let errorMessage = 'Login failed. Please check your credentials.';
            
        if (error.response) {
          errorMessage = error.response.data?.error || error.response.data?.message || errorMessage;
        } else if (error.request) {
          errorMessage = 'Network error - please check your internet connection';
        }
        
        Swal.fire({
          title: 'Error',
          text: errorMessage,
          icon: 'error',
          background: '#1e293b',
          color: '#ffffff'
        });
      } finally {
        loadingStates.value.login = false;
      }
    };
    
    const logout = async () => {
      try {
        await axios.post('/api/logout');
      } catch (error) {
        console.error('Logout error:', error);
      } finally {
        // Don't remove session token to maintain one-time login
        currentPage.value = 'login';
      }
    };
    
    const navigateTo = (page) => {
      currentPage.value = page;
    };
    
    const submitFollowRequest = async () => {
      try {
        loadingStates.value.follow = true;
        const response = await axios.post('/api/follow', {
          link: followForm.value.link,
          limit: followForm.value.limit
        });
        
        if (response.data.cooldown) {
          cooldownTime.value = response.data.cooldown;
          currentPage.value = 'cooldown';
          localStorage.setItem('cooldownTool', 'follow');
        } else {
          Swal.fire({
            title: 'Success',
            text: `Successfully sent ${response.data.count} follows`,
            icon: 'success',
            background: '#1e293b',
            color: '#ffffff'
          });
        }
      } catch (error) {
        if (error.response?.data?.cooldown) {
          cooldownTime.value = error.response.data.cooldown;
          currentPage.value = 'cooldown';
          localStorage.setItem('cooldownTool', 'follow');
        } else {
          Swal.fire({
            title: 'Error',
            text: error.response?.data?.message || 'Failed to send follows',
            icon: 'error',
            background: '#1e293b',
            color: '#ffffff'
          });
        }
      } finally {
        loadingStates.value.follow = false;
      }
    };
    
    const submitReactionRequest = async () => {
      try {
        loadingStates.value.reactions = true;
        const response = await axios.post('/api/reactions', {
          link: reactionForm.value.link,
          type: reactionForm.value.type,
          limit: reactionForm.value.limit
        });
        
        if (response.data.cooldown) {
          cooldownTime.value = response.data.cooldown;
          currentPage.value = 'cooldown';
          localStorage.setItem('cooldownTool', 'reactions');
        } else {
          Swal.fire({
            title: 'Success',
            text: `Successfully sent ${response.data.count} reactions`,
            icon: 'success',
            background: '#1e293b',
            color: '#ffffff'
          });
        }
      } catch (error) {
        if (error.response?.data?.cooldown) {
          cooldownTime.value = error.response.data.cooldown;
          currentPage.value = 'cooldown';
          localStorage.setItem('cooldownTool', 'reactions');
        } else {
          Swal.fire({
            title: 'Error',
            text: error.response?.data?.message || 'Failed to send reactions',
            icon: 'error',
            background: '#1e293b',
            color: '#ffffff'
          });
        }
      } finally {
        loadingStates.value.reactions = false;
      }
    };
    
    const submitShareRequest = async () => {
      try {
        loadingStates.value.share = true;
        
        Swal.fire({
          title: 'Sharing Started',
          text: 'Please wait while shares are being sent...',
          icon: 'success',
          background: '#1e293b',
          color: '#ffffff'
        });
    
        const response = await axios.post('/api/share', {
          link: shareForm.value.link,
          delay: shareForm.value.delay * 1000,
          limit: shareForm.value.limit
        });
        
        if (response.data.success) {
          Swal.fire({
            title: 'Success',
            text: `Successfully sent ${response.data.count} shares`,
            icon: 'success',
            background: '#1e293b',
            color: '#ffffff'
          });
        } else {
          Swal.fire({
            title: 'Partial Success',
            text: `Shares completed with ${response.data.count} successes out of ${response.data.totalAttempted}`,
            icon: 'info',
            background: '#1e293b',
            color: '#ffffff'
          });
        }
      } catch (error) {
        Swal.fire({
          title: 'Error',
          text: error.response?.data?.error || 'Failed to start sharing process',
          icon: 'error',
          background: '#1e293b',
          color: '#ffffff'
        });
      } finally {
        loadingStates.value.share = false;
      }
    };
    
    const activateProfileGuard = async () => {
      try {
        loadingStates.value.guardOn = true;
        await axios.post('/api/profile-guard', {
          action: 'activate'
        });
        
        Swal.fire({
          title: 'Success',
          text: 'Profile guard activated successfully',
          icon: 'success',
          background: '#1e293b',
          color: '#ffffff'
        });
      } catch (error) {
        Swal.fire({
          title: 'Error',
          text: error.response?.data?.message || 'Failed to activate profile guard',
          icon: 'error',
          background: '#1e293b',
          color: '#ffffff'
        });
      } finally {
        loadingStates.value.guardOn = false;
      }
    };
    
    const deactivateProfileGuard = async () => {
      try {
        loadingStates.value.guardOff = true;
        await axios.post('/api/profile-guard', {
          action: 'deactivate'
        });
        
        Swal.fire({
          title: 'Success',
          text: 'Profile guard deactivated successfully',
          icon: 'success',
          background: '#1e293b',
          color: '#ffffff'
        });
      } catch (error) {
        Swal.fire({
          title: 'Error',
          text: error.response?.data?.message || 'Failed to deactivate profile guard',
          icon: 'error',
          background: '#1e293b',
          color: '#ffffff'
        });
      } finally {
        loadingStates.value.guardOff = false;
      }
    };
    
    return {
      currentPage,
      loadingStates,
      user,
      cooldownTime,
      loginForm,
      followForm,
      reactionForm,
      shareForm,
      handleLogin,
      logout,
      navigateTo,
      submitFollowRequest,
      submitReactionRequest,
      submitShareRequest,
      activateProfileGuard,
      deactivateProfileGuard,
      getCooldownMessage
    };
  }
}).mount('#app');

// PWA Installation Handling
document.addEventListener('DOMContentLoaded', () => {
  let deferredPrompt;
  const pwaInstallModal = document.getElementById('pwaInstallModal');
  const pwaInstallConfirm = document.getElementById('pwaInstallConfirm');
  const pwaInstallCancel = document.getElementById('pwaInstallCancel');
  const pwaManualInstall = document.getElementById('pwaManualInstall');

  // Check if the app is already installed
  const isRunningAsPWA = window.matchMedia('(display-mode: standalone)').matches;
  if (isRunningAsPWA) {
    console.log('App is running as PWA');
    return;
  }

  // Listen for beforeinstallprompt event
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    
    // Show the install modal
    pwaInstallModal.classList.add('active');
    
    // Set a timeout to show the manual install button if the prompt isn't shown
    setTimeout(() => {
      if (deferredPrompt) {
        pwaManualInstall.classList.add('show');
      }
    }, 10000);
  });

  // Install button click handler
  pwaInstallConfirm.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    
    pwaInstallModal.classList.remove('active');
    deferredPrompt.prompt();
    
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response: ${outcome}`);
    
    deferredPrompt = null;
  });

  // Cancel button handler
  pwaInstallCancel.addEventListener('click', () => {
    pwaInstallModal.classList.remove('active');
  });

  // Manual install button handler
  pwaManualInstall.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`User response: ${outcome}`);
      
      if (outcome === 'accepted') {
        pwaManualInstall.classList.remove('show');
      }
    } else {
      // Fallback instructions
      Swal.fire({
        title: 'Install App',
        text: 'To install this app, look for the "Add to Home Screen" option in your browser\'s menu.',
        icon: 'info',
        background: document.documentElement.classList.contains('dark') ? '#1e293b' : '#ffffff',
        color: document.documentElement.classList.contains('dark') ? '#ffffff' : '#000000'
      });
    }
  });

  // Check if app was successfully installed
  window.addEventListener('appinstalled', () => {
    pwaInstallModal.classList.remove('active');
    pwaManualInstall.classList.remove('show');
    console.log('PWA was installed');
  });
});