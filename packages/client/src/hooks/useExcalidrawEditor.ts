import { useState, useCallback } from 'react';
import { restoreElements } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { ElementService } from '../services/elementService';
import logger from '../utils/logger';

export const useExcalidrawEditor = (boardId: string | undefined) => {
  const [elements, setElements] = useState<ExcalidrawElement[]>([]);
  const [files, setFiles] = useState<BinaryFiles>({});
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);

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
        ElementService.replaceAllElements(boardId, { elements: elementsArray, files: filesMap }).catch(
          error => logger.error('Error saving scene data:', error, true)
        );
      }
    },
    [boardId]
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
