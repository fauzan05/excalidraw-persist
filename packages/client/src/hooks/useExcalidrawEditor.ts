import { useState, useCallback, useRef, useEffect } from 'react';
import { restoreElements } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { ElementService, type BoardSceneData } from '../services/elementService';
import logger from '../utils/logger';

export const useExcalidrawEditor = (boardId: string | undefined) => {
  const [elements, setElements] = useState<ExcalidrawElement[]>([]);
  const [files, setFiles] = useState<BinaryFiles>({});
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const pendingSceneRef = useRef<BoardSceneData | null>(null);
  const inFlightRef = useRef(false);
  const boardIdRef = useRef(boardId);
  boardIdRef.current = boardId;

  const flushSave = useCallback(async () => {
    const currentBoardId = boardIdRef.current;
    if (!currentBoardId || inFlightRef.current) {
      return;
    }
    const scene = pendingSceneRef.current;
    if (!scene) {
      return;
    }
    pendingSceneRef.current = null;
    inFlightRef.current = true;
    try {
      await ElementService.replaceAllElements(currentBoardId, scene);
    } catch (error) {
      logger.error('Error saving scene data:', error, true);
    } finally {
      inFlightRef.current = false;
      if (pendingSceneRef.current) {
        void flushSave();
      }
    }
  }, []);

  useEffect(() => {
    pendingSceneRef.current = null;
  }, [boardId]);

  const handleChange = useCallback(
    (excalidrawElements: readonly ExcalidrawElement[], excalidrawFiles: BinaryFiles | null) => {
      let elementsArray: ExcalidrawElement[] = [...excalidrawElements];
      try {
        elementsArray = restoreElements(elementsArray, null);
      } catch {
        // keep the editor snapshot if restore cannot assign indices
      }
      const filesMap: BinaryFiles = excalidrawFiles ? { ...excalidrawFiles } : {};

      setElements(elementsArray);
      setFiles(filesMap);

      if (boardId) {
        pendingSceneRef.current = { elements: elementsArray, files: filesMap };
        void flushSave();
      }
    },
    [boardId, flushSave]
  );

  return {
    elements,
    setElements,
    files,
    setFiles,
    excalidrawAPI,
    setExcalidrawAPI,
    handleChange,
  };
};
