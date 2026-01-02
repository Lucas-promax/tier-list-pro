import React, { useState, useEffect, useRef } from 'react';
import { Upload, Plus, Download, GripVertical, Settings, Image as ImageIcon, FileJson, FolderOpen, RotateCcw, X, AlertTriangle, Trash2, Save, FileSignature, Eraser } from 'lucide-react';

// --- IndexedDB Utility ---
const DB_NAME = 'TierListDB_v15'; // Version bumped
const DB_VERSION = 1;
const STORE_CONFIG = 'config';
const STORE_IMAGES = 'images';

const initDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = (event) => reject(event.target.error);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_CONFIG)) {
        db.createObjectStore(STORE_CONFIG, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES, { keyPath: 'id' });
      }
    };
    request.onsuccess = (event) => resolve(event.target.result);
  });
};

const dbOperate = async (storeName, mode, callback) => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], mode);
    const store = transaction.objectStore(storeName);
    const request = callback(store);
    
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onerror = (event) => reject(event.target.error);
  });
};

// --- Helper: Blob <-> Base64 ---
const blobToBase64 = (blob) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

const base64ToBlob = async (base64Data) => {
  const res = await fetch(base64Data);
  return await res.blob();
};

// --- Component ---

export default function TierListMaker() {
  // Default Config
  const defaultTiers = [
    { id: 'tier-s', label: 'S', color: '#ff7f7f', imageIds: [] },
    { id: 'tier-a', label: 'A', color: '#ffbf7f', imageIds: [] },
    { id: 'tier-b', label: 'B', color: '#ffdf7f', imageIds: [] },
    { id: 'tier-c', label: 'C', color: '#ffff7f', imageIds: [] },
    { id: 'tier-d', label: 'D', color: '#bfff7f', imageIds: [] },
  ];

  const [tiers, setTiers] = useState(defaultTiers);
  const [sidebarImageIds, setSidebarImageIds] = useState([]);
  const [imagesMap, setImagesMap] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  // State for Confirmation Modal (Reset/Import)
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false, title: '', message: '', onConfirm: null, confirmText: '确定', confirmColor: 'bg-blue-600'
  });

  // State for Save File Modal (Export/Save Image)
  const [saveModal, setSaveModal] = useState({
    isOpen: false,
    fileName: '',
    fileExtension: '', // .json or .png
    fileBlob: null,
    title: ''
  });

  // --- DRAG STATE ---
  const [activeDragId, setActiveDragId] = useState(null);
  const [dragSource, setDragSource] = useState(null); // { tierId }
  const [dropTarget, setDropTarget] = useState(null); // { tierId, index }

  const dragItemRef = useRef(null); 
  const fileInputRef = useRef(null);
  const importInputRef = useRef(null);
  const exportRef = useRef(null);

  // --- HTML2Canvas Loader ---
  useEffect(() => {
    if (!window.html2canvas) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  // --- Init Data ---
  const loadData = async () => {
    setIsLoading(true);
    try {
      const savedTiers = await dbOperate(STORE_CONFIG, 'readonly', (store) => store.get('tiers'));
      const savedSidebar = await dbOperate(STORE_CONFIG, 'readonly', (store) => store.get('sidebar'));
      
      if (savedTiers) setTiers(savedTiers.data);
      if (savedSidebar) setSidebarImageIds(savedSidebar.data);

      const allImages = await dbOperate(STORE_IMAGES, 'readonly', (store) => store.getAll());
      const urlMap = {};
      if (allImages && allImages.length > 0) {
        allImages.forEach(imgData => {
           urlMap[imgData.id] = URL.createObjectURL(imgData.blob);
        });
      }
      setImagesMap(urlMap);
    } catch (err) {
      console.error("Load failed:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // --- Persistence ---
  const saveConfigToDB = async (currentTiers, currentSidebar) => {
    await dbOperate(STORE_CONFIG, 'readwrite', (store) => store.put({ id: 'tiers', data: currentTiers }));
    await dbOperate(STORE_CONFIG, 'readwrite', (store) => store.put({ id: 'sidebar', data: currentSidebar }));
  };

  const saveImageToDB = async (id, blob) => {
    await dbOperate(STORE_IMAGES, 'readwrite', (store) => store.put({ id, blob }));
  };

  const deleteImageFromDB = async (id) => {
    setImagesMap(prev => {
        const next = { ...prev };
        if (next[id]) URL.revokeObjectURL(next[id]);
        delete next[id]; 
        return next;
    });
    
    const db = await initDB();
    const tx = db.transaction([STORE_IMAGES], 'readwrite');
    tx.objectStore(STORE_IMAGES).delete(id);
  };

  // --- UNIVERSAL DOWNLOAD TRIGGER ---
  const triggerDownload = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // --- File Processing Logic (Shared) ---
  const processFiles = async (filesList) => {
    const files = Array.from(filesList);
    if (files.length === 0) return;

    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    setIsProcessing(true); // Reuse isProcessing to show loading state

    const newIds = [];
    const newMapEntries = {};

    for (const file of imageFiles) {
      const id = 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      newIds.push(id);
      
      await saveImageToDB(id, file);
      newMapEntries[id] = URL.createObjectURL(file);
    }

    // Update State
    setImagesMap(prev => ({ ...prev, ...newMapEntries }));
    
    // Save to DB and Update Sidebar State
    setSidebarImageIds(prev => {
        const next = [...prev, ...newIds];
        saveConfigToDB(tiers, next);
        return next;
    });

    setIsProcessing(false);
  };

  const handleFileUpload = async (e) => {
    await processFiles(e.target.files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // --- Import/Export ---
  
  // 1. Prepare Config Data
  const handleExportState = async () => {
    setIsProcessing(true);
    try {
      const allImages = await dbOperate(STORE_IMAGES, 'readonly', (store) => store.getAll());
      const imagesPayload = {};
      for (const img of allImages) {
        imagesPayload[img.id] = await blobToBase64(img.blob);
      }
      const state = {
        version: 1, date: new Date().toISOString(), tiers, sidebarImageIds, images: imagesPayload
      };
      
      const content = JSON.stringify(state);
      const blob = new Blob([content], { type: 'application/json' });
      
      // Open Save Modal
      setSaveModal({
        isOpen: true,
        fileName: `tier-list-${Date.now()}`,
        fileExtension: '.tmp',
        fileBlob: blob,
        title: '保存配置'
      });
      
    } catch (error) {
      console.error("Export failed", error);
      alert("导出准备失败，请检查数据量是否过大");
    } finally {
      setIsProcessing(false);
    }
  };

  // 2. Prepare Image Data
  const exportImage = () => {
    if (!window.html2canvas) return alert("插件加载中，请稍后");
    
    // Show Loading
    setIsProcessing(true);
    
    const ctrls = document.querySelectorAll('.tier-controls');
    ctrls.forEach(c => c.style.display = 'none');
    
    // Small timeout to allow UI to update (hide controls)
    setTimeout(() => {
        window.html2canvas(exportRef.current, { backgroundColor: '#1f2937', useCORS: true, scale: 2, logging: false })
          .then(canvas => {
            canvas.toBlob((blob) => {
                // Restore UI
                ctrls.forEach(c => c.style.display = 'flex');
                setIsProcessing(false);

                if (!blob) return alert("生成图片失败");
                
                // Open Save Modal
                setSaveModal({
                    isOpen: true,
                    fileName: `tier-list-${Date.now()}`,
                    fileExtension: '.png',
                    fileBlob: blob,
                    title: '保存图片 (PNG)'
                });
            }, 'image/png');
          })
          .catch(err => {
             console.error(err);
             alert("截图失败");
             ctrls.forEach(c => c.style.display = 'flex');
             setIsProcessing(false);
          });
    }, 100);
  };

  const handleImportState = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setConfirmModal({
      isOpen: true,
      title: '确认导入',
      message: '导入配置将覆盖当前所有进度，确定继续吗？',
      confirmText: '覆盖导入',
      confirmColor: 'bg-blue-600',
      onConfirm: async () => {
        setIsProcessing(true);
        try {
          const text = await file.text();
          const state = JSON.parse(text);
          if (!state.tiers || !state.images) throw new Error("Invalid format");

          const db = await initDB();
          const tx = db.transaction([STORE_CONFIG, STORE_IMAGES], 'readwrite');
          tx.objectStore(STORE_CONFIG).clear();
          tx.objectStore(STORE_IMAGES).clear();
          await new Promise((resolve) => { tx.oncomplete = resolve; });

          for (const [id, base64] of Object.entries(state.images)) {
            const blob = await base64ToBlob(base64);
            await saveImageToDB(id, blob);
          }
          await saveConfigToDB(state.tiers, state.sidebarImageIds);
          await loadData();
        } catch (error) {
          console.error("Import failed", error);
          alert("导入失败，文件格式可能已损坏");
        } finally {
          setIsProcessing(false);
          e.target.value = '';
        }
      }
    });
  };

  // --- CORE DRAG & DROP LOGIC ---

  const handleDragStart = (e, id, sourceTierId) => {
    dragItemRef.current = { id, sourceTierId };
    setDragSource({ tierId: sourceTierId });
    
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);

    const imgEl = document.getElementById(`img-content-${id}`);
    if (imgEl) e.dataTransfer.setDragImage(imgEl, 40, 40);

    setTimeout(() => {
        setActiveDragId(id);
    }, 0);
  };

  const handleDragEnd = () => {
    setActiveDragId(null);
    setDragSource(null);
    setDropTarget(null);
    dragItemRef.current = null;
  };

  const handleDragOverItem = (e, targetTierId, targetItemId, indexInFilteredList) => {
    e.preventDefault();
    e.stopPropagation();

    if (!dragItemRef.current) return;
    const { id: dragId } = dragItemRef.current;

    if (dragId === targetItemId) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const isLeft = e.clientX < midX;
    
    const insertionIndex = isLeft ? indexInFilteredList : indexInFilteredList + 1;

    setDropTarget(prev => {
        if (prev && prev.tierId === targetTierId && prev.index === insertionIndex) return prev;
        return { tierId: targetTierId, index: insertionIndex };
    });
  };

  const handleDragOverContainer = (e, targetTierId, itemCountInFilteredList) => {
    e.preventDefault();
    if (!dragItemRef.current) return;
    
    setDropTarget(prev => {
      if (prev && prev.tierId === targetTierId && prev.index === itemCountInFilteredList) return prev;
      return { tierId: targetTierId, index: itemCountInFilteredList };
    });
  };

  const handleDrop = (e) => {
    e.preventDefault();

    // 1. Handle External File Drop (Drag & Drop Upload)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        processFiles(e.dataTransfer.files);
        // Clear drag state just in case
        handleDragEnd(); 
        return;
    }

    const dragItem = dragItemRef.current;
    
    if (!dragItem || !dropTarget) {
      handleDragEnd();
      return;
    }

    const { id: dragId, sourceTierId } = dragItem;
    const { tierId: targetTierId, index: insertionIndex } = dropTarget;

    // --- Perform Data Move ---
    let newTiers = [...tiers];
    let newSidebar = [...sidebarImageIds];

    if (sourceTierId === 'sidebar') {
      newSidebar = newSidebar.filter(id => id !== dragId);
    } else {
      const sourceTier = newTiers.find(t => t.id === sourceTierId);
      if (sourceTier) {
        sourceTier.imageIds = sourceTier.imageIds.filter(id => id !== dragId);
      }
    }

    if (targetTierId === 'TRASH') {
        deleteImageFromDB(dragId);
    } else {
        let targetList = targetTierId === 'sidebar' 
          ? newSidebar 
          : newTiers.find(t => t.id === targetTierId)?.imageIds;

        if (targetList) {
          const finalIndex = Math.min(insertionIndex, targetList.length);
          targetList.splice(finalIndex, 0, dragId);
        }
    }

    setTiers(newTiers);
    setSidebarImageIds(newSidebar);
    saveConfigToDB(newTiers, newSidebar);
    
    handleDragEnd();
  };

  // --- LOGIC: RESET & CLEAR ---
  
  // 1. CLEAR BOARD (Yellow Button)
  const executeClearBoard = () => {
    const allTierImages = tiers.flatMap(t => t.imageIds);
    if (allTierImages.length === 0) return;
    const nextSidebar = Array.from(new Set([...sidebarImageIds, ...allTierImages]));
    const nextTiers = tiers.map(t => ({ ...t, imageIds: [] }));
    setTiers(nextTiers);
    setSidebarImageIds(nextSidebar);
    saveConfigToDB(nextTiers, nextSidebar);
  };

  const handleClearBoardClick = () => {
    setConfirmModal({
      isOpen: true,
      title: '清空评级板',
      message: '确定要清空评级板吗？所有图片将回到下方的待选图片库中，不会删除图片。',
      confirmText: '确定清空',
      confirmColor: 'bg-yellow-600',
      onConfirm: executeClearBoard
    });
  };

  // 2. FACTORY RESET (Red Button)
  const executeFactoryReset = async () => {
    // Clear all data from DB
    const db = await initDB();
    const tx = db.transaction([STORE_CONFIG, STORE_IMAGES], 'readwrite');
    tx.objectStore(STORE_CONFIG).clear();
    tx.objectStore(STORE_IMAGES).clear();
    
    // Reset state to default
    setTiers(defaultTiers);
    setSidebarImageIds([]);
    setImagesMap({}); // Revoke URLs might be needed properly but for full reset mostly fine
    
    // Save default state
    saveConfigToDB(defaultTiers, []);
  };

  const handleFactoryResetClick = () => {
    setConfirmModal({
      isOpen: true,
      title: '完全重置 (初始化)',
      message: '警告：此操作将删除所有图片和设置，将应用恢复到最初状态！该操作无法撤销。',
      confirmText: '确认初始化',
      confirmColor: 'bg-red-600',
      onConfirm: executeFactoryReset
    });
  };

  const returnTierToPool = (tierId) => {
    const tier = tiers.find(t => t.id === tierId);
    if (!tier || tier.imageIds.length === 0) return;
    const nextSidebar = Array.from(new Set([...sidebarImageIds, ...tier.imageIds]));
    const nextTiers = tiers.map(t => t.id === tierId ? { ...t, imageIds: [] } : t);
    setTiers(nextTiers);
    setSidebarImageIds(nextSidebar);
    saveConfigToDB(nextTiers, nextSidebar);
  };

  // --- UI Operations ---
  const addNewTier = () => {
    const newTier = { id: `tier-${Date.now()}`, label: 'NEW', color: '#cccccc', imageIds: [] };
    const nextTiers = [...tiers, newTier];
    setTiers(nextTiers);
    saveConfigToDB(nextTiers, sidebarImageIds);
  };

  const updateTier = (id, field, value) => {
    const nextTiers = tiers.map(t => t.id === id ? { ...t, [field]: value } : t);
    setTiers(nextTiers);
    saveConfigToDB(nextTiers, sidebarImageIds);
  };

  const deleteTier = (id) => {
    const tier = tiers.find(t => t.id === id);
    if (!tier) return;
    const nextSidebar = [...sidebarImageIds, ...tier.imageIds];
    const nextTiers = tiers.filter(t => t.id !== id);
    setTiers(nextTiers);
    setSidebarImageIds(nextSidebar);
    saveConfigToDB(nextTiers, nextSidebar);
  };

  const moveTier = (index, direction) => {
    if ((direction === -1 && index === 0) || (direction === 1 && index === tiers.length - 1)) return;
    const nextTiers = [...tiers];
    const temp = nextTiers[index];
    nextTiers[index] = nextTiers[index + direction];
    nextTiers[index + direction] = temp;
    setTiers(nextTiers);
    saveConfigToDB(nextTiers, sidebarImageIds);
  };

  // --- RENDER HELPERS ---
  
  const renderListItems = (tierId, currentImageIds) => {
    const filteredIds = currentImageIds.filter(id => id !== activeDragId);
    const displayItems = filteredIds.map(id => ({ type: 'ITEM', id }));

    if (dropTarget && dropTarget.tierId === tierId && dropTarget.tierId !== 'TRASH' && activeDragId) {
        let idx = dropTarget.index;
        if (idx > displayItems.length) idx = displayItems.length;
        displayItems.splice(idx, 0, { type: 'GHOST', id: activeDragId });
    }

    return (
      <>
        {displayItems.map((item, idx) => {
            if (item.type === 'GHOST') {
                 return (
                     <div 
                         key="ghost-placeholder"
                         onDragOver={(e) => {
                             e.preventDefault();
                             e.stopPropagation();
                         }}
                         className="w-20 h-20 m-1 flex-shrink-0 bg-gray-600/50 rounded-md border-2 border-dashed border-blue-400 animate-pulse flex items-center justify-center pointer-events-auto"
                     >
                         <img 
                           src={imagesMap[activeDragId]} 
                           className="w-full h-full object-cover opacity-50 rounded-md grayscale" 
                           alt="ghost" 
                         />
                     </div>
                 );
            }
            
            const realIndex = idx - (displayItems.slice(0, idx).filter(i => i.type === 'GHOST').length);
            
            return (
                <div 
                    key={item.id}
                    className="relative w-20 h-20 m-1 flex-shrink-0 group cursor-grab active:cursor-grabbing hover:scale-105 transition-transform"
                    draggable="true"
                    onDragStart={(e) => handleDragStart(e, item.id, tierId)}
                    onDragOver={(e) => handleDragOverItem(e, tierId, item.id, realIndex)}
                >
                    <img 
                        id={`img-content-${item.id}`}
                        src={imagesMap[item.id]} 
                        alt="item" 
                        className="w-full h-full object-cover rounded-md shadow-sm select-none pointer-events-none" 
                    />
                    <div className="absolute inset-0 bg-transparent" />
                </div>
            );
        })}

        {currentImageIds.includes(activeDragId) && (
            <div style={{ position: 'absolute', width: 0, height: 0, opacity: 0, overflow: 'hidden', pointerEvents: 'none' }}>
                <img src={imagesMap[activeDragId]} alt="hidden source" />
            </div>
        )}
      </>
    );
  };


  if (isLoading) return <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">加载中...</div>;

  return (
    <div 
        className="min-h-screen bg-gray-900 text-gray-100 font-sans flex flex-col" 
        onDragOver={(e) => {
            e.preventDefault();
            // Show copy cursor if dragging external files
            if (e.dataTransfer.types.includes('Files')) {
                e.dataTransfer.dropEffect = 'copy';
            }
        }} 
        onDrop={handleDrop}
    >
      
      {/* 1. GLOBAL CONFIRM MODAL (Reset/Import) */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-gray-800 border border-gray-700 p-6 rounded-2xl shadow-2xl max-w-sm w-full">
            <div className="flex items-center gap-3 mb-4">
               <div className="bg-yellow-500/10 p-2 rounded-full"><AlertTriangle className="text-yellow-500" size={24} /></div>
               <h3 className="text-xl font-bold text-white">{confirmModal.title}</h3>
            </div>
            <p className="text-gray-300 mb-8 leading-relaxed">{confirmModal.message}</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmModal({ ...confirmModal, isOpen: false })} className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200">取消</button>
              <button onClick={() => { if (confirmModal.onConfirm) confirmModal.onConfirm(); setConfirmModal({ ...confirmModal, isOpen: false }); }} className={`px-4 py-2 rounded-lg text-white ${confirmModal.confirmColor}`}>{confirmModal.confirmText}</button>
            </div>
          </div>
        </div>
      )}

      {/* 2. SAVE FILE MODAL (Name Input) */}
      {saveModal.isOpen && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-gray-800 border border-gray-700 p-6 rounded-2xl shadow-2xl max-w-sm w-full">
            <div className="flex items-center gap-3 mb-4">
               <div className="bg-green-500/10 p-2 rounded-full"><FileSignature className="text-green-500" size={24} /></div>
               <h3 className="text-xl font-bold text-white">{saveModal.title}</h3>
            </div>
            
            <div className="mb-6">
                <label className="block text-gray-400 text-sm mb-2">文件名称</label>
                <div className="flex items-center bg-gray-900 rounded-lg border border-gray-600 focus-within:border-blue-500">
                    <input 
                        type="text" 
                        value={saveModal.fileName}
                        onChange={(e) => setSaveModal({...saveModal, fileName: e.target.value})}
                        className="bg-transparent border-none text-white px-3 py-2 flex-1 outline-none w-full"
                        autoFocus
                    />
                    <span className="text-gray-500 px-3 border-l border-gray-700 bg-gray-800/50 h-full flex items-center">
                        {saveModal.fileExtension}
                    </span>
                </div>
            </div>

            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setSaveModal({ ...saveModal, isOpen: false })} 
                className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200"
              >
                取消
              </button>
              <button 
                onClick={() => {
                    if (!saveModal.fileName.trim()) return alert("请输入文件名");
                    const fullName = saveModal.fileName + saveModal.fileExtension;
                    triggerDownload(saveModal.fileBlob, fullName);
                    setSaveModal({ ...saveModal, isOpen: false });
                }} 
                className="px-4 py-2 rounded-lg text-white bg-green-600 hover:bg-green-500 shadow-lg"
              >
                下载保存
              </button>
            </div>
          </div>
        </div>
      )}

      {isProcessing && (
        <div className="fixed inset-0 bg-black/70 z-[200] flex items-center justify-center text-white">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent mb-4"></div>
        </div>
      )}

      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 p-4 sticky top-0 z-50 shadow-xl">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2 select-none">
            <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-2 rounded-lg shadow-lg">
              <GripVertical size={24} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-300">
              Tier Maker Pro
            </h1>
          </div>
          <div className="flex flex-wrap gap-2 justify-center">
            <div className="relative">
              <input ref={importInputRef} type="file" accept=".tmp,.json" className="hidden" onChange={handleImportState} />
              <button onClick={() => importInputRef.current.click()} className="flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"><FolderOpen size={16} /> 导入</button>
            </div>
            <button onClick={handleExportState} className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm transition-colors shadow-lg shadow-indigo-900/20"><FileJson size={16} /> 保存配置</button>
            <button onClick={exportImage} className="flex items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-medium transition-colors"><Download size={16} /> 保存图片</button>
            <div className="h-6 w-px bg-gray-600 mx-1"></div>
            <button onClick={() => setShowSettings(!showSettings)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${showSettings ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'}`}><Settings size={16} /> 设置</button>
            
            {/* Clear Board Button (Yellow) */}
            <button onClick={handleClearBoardClick} className="flex items-center gap-2 px-3 py-2 bg-yellow-600/90 hover:bg-yellow-500 text-white rounded-lg text-sm transition-colors"><RotateCcw size={16} /> <span className="hidden sm:inline">清空</span></button>
            
            {/* Factory Reset Button (Red) */}
            <button onClick={handleFactoryResetClick} className="flex items-center gap-2 px-3 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg text-sm transition-colors shadow-lg shadow-red-900/20" title="初始化一切"><Trash2 size={16} /> <span className="hidden sm:inline">重置</span></button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 flex flex-col gap-8 pb-20">
        <div ref={exportRef} className="bg-gray-800 rounded-xl shadow-2xl border border-gray-700 overflow-hidden">
          {tiers.map((tier, index) => {
             const realCount = tier.imageIds.filter(id => id !== activeDragId).length;

             return (
              <div 
                key={tier.id} 
                className={`flex border-b border-gray-900 last:border-none min-h-[100px] bg-gray-900 transition-colors ${dropTarget?.tierId === tier.id ? 'bg-gray-800/80' : ''}`}
                onDragOver={(e) => handleDragOverContainer(e, tier.id, realCount)}
              >
                <div className="w-24 md:w-32 flex-shrink-0 flex flex-col items-center justify-center p-2 text-center relative" style={{ backgroundColor: tier.color }}>
                  {showSettings ? (
                    <div className="flex flex-col gap-2 w-full tier-controls animate-in fade-in zoom-in duration-200">
                      <input value={tier.label} onChange={(e) => updateTier(tier.id, 'label', e.target.value)} className="bg-black/20 text-white text-center w-full rounded px-1 py-1 font-bold text-sm" />
                      <div className="flex gap-1 justify-center w-full">
                         <input type="color" value={tier.color} onChange={(e) => updateTier(tier.id, 'color', e.target.value)} className="w-8 h-8 cursor-pointer rounded overflow-hidden border-0 p-0" />
                         <button onClick={() => deleteTier(tier.id)} className="w-8 h-8 bg-black/20 hover:bg-red-600 rounded flex items-center justify-center text-white"><X size={14} /></button>
                      </div>
                      <div className="flex gap-1 justify-center w-full">
                         <button onClick={() => moveTier(index, -1)} className="text-xs bg-black/20 hover:bg-black/40 px-2 rounded">▲</button>
                         <button onClick={() => moveTier(index, 1)} className="text-xs bg-black/20 hover:bg-black/40 px-2 rounded">▼</button>
                         <button onClick={() => returnTierToPool(tier.id)} className="text-xs bg-black/20 hover:bg-yellow-500/80 px-2 rounded flex items-center justify-center text-white"><Eraser size={12} /></button>
                      </div>
                    </div>
                  ) : (
                    <span className="text-2xl md:text-3xl font-black text-black/70 drop-shadow-sm select-none break-words w-full px-1">{tier.label}</span>
                  )}
                </div>
                <div className="flex-1 flex flex-wrap content-start items-start p-2 gap-2 min-h-[100px] bg-gray-800 relative">
                  {renderListItems(tier.id, tier.imageIds)}
                </div>
              </div>
            );
          })}
        </div>

        {showSettings && (
           <button onClick={addNewTier} className="w-full py-4 border-2 border-dashed border-gray-700 rounded-xl hover:border-gray-500 hover:bg-gray-800 text-gray-400 transition-all flex items-center justify-center gap-2 font-medium">
            <Plus size={20} /> 添加新评级行
          </button>
        )}

        <div className="flex flex-col gap-4">
           <div className="flex items-center justify-between border-b border-gray-700 pb-2">
              <h2 className="text-xl font-bold flex items-center gap-2 text-gray-200">
                <ImageIcon className="text-blue-400" /> 待选图片库 <span className="text-sm bg-gray-800 px-2 py-0.5 rounded-full text-gray-400">{sidebarImageIds.length}</span>
              </h2>
              <label className="cursor-pointer bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors text-sm font-medium shadow-lg shadow-blue-900/20">
                <Upload size={16} /> 上传图片
                <input ref={fileInputRef} type="file" className="hidden" multiple accept="image/*" onChange={handleFileUpload} />
              </label>
           </div>
           
           {(() => {
              const realCount = sidebarImageIds.filter(id => id !== activeDragId).length;
              return (
                 <div 
                   className={`min-h-[200px] bg-gray-800/50 rounded-xl border-2 border-dashed border-gray-700 p-4 transition-colors relative ${dropTarget?.tierId === 'sidebar' ? 'bg-gray-700/50' : ''}`}
                   onDragOver={(e) => handleDragOverContainer(e, 'sidebar', realCount)}
                 >
                    {realCount === 0 && !activeDragId && (
                       <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 pointer-events-none">
                          <Upload size={48} className="mb-4 opacity-20" />
                          <p>暂无图片，请点击右上角上传或拖拽图片至此</p>
                       </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                        {renderListItems('sidebar', sidebarImageIds)}
                    </div>
                 </div>
              );
           })()}
           
           {/* Trash Zone */}
           <div 
             className={`mt-4 border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center transition-all duration-300 ${
                 dropTarget?.tierId === 'TRASH' 
                    ? 'border-red-500 bg-red-500/20 scale-100 opacity-100' 
                    : 'border-gray-700 bg-gray-800/30 text-gray-500 hover:border-red-900/50'
             }`}
             onDragOver={(e) => {
                 e.preventDefault();
                 if(!dragItemRef.current) return;
                 setDropTarget({ tierId: 'TRASH', index: 0 }); 
             }}
           >
              <Trash2 
                 size={32} 
                 className={`transition-all duration-300 ${dropTarget?.tierId === 'TRASH' ? 'text-red-500 scale-125' : 'text-gray-500'}`} 
              />
              <span className={`mt-2 text-sm font-medium transition-colors ${dropTarget?.tierId === 'TRASH' ? 'text-red-400' : 'text-gray-500'}`}>
                 {dropTarget?.tierId === 'TRASH' ? '松手即可删除' : '拖拽至此删除图片'}
              </span>
           </div>
        </div>
      </main>

      <footer className="p-6 text-center text-gray-600 text-sm mt-auto border-t border-gray-800">
        <p>Tier Maker Pro &copy; 2026 - Powered by IndexedDB</p>
      </footer>
    </div>
  );
}