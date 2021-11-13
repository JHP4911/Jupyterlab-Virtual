import { Widget, BoxLayout } from '@lumino/widgets';
import { IDisposable, DisposableDelegate } from '@lumino/disposable';
import { Drag, IDragEvent } from '@lumino/dragdrop';
import {
  LabIcon,
  runIcon,
  editIcon,
  launcherIcon,
  closeIcon,
  Switch
} from '@jupyterlab/ui-components';
import {
  NotebookPanel,
  INotebookModel,
  INotebookTracker,
  NotebookActions
} from '@jupyterlab/notebook';
import { IChangedArgs } from '@jupyterlab/coreutils';
import { CodeCell, ICodeCellModel, Cell, ICellModel } from '@jupyterlab/cells';
import { ICodeMirror } from '@jupyterlab/codemirror';
import CodeMirror from 'codemirror';
import { toArray } from '@lumino/algorithm';
import { IRenderMime } from '@jupyterlab/rendermime-interfaces';
import { StickyContent, ContentType } from './content';

/**
 * Class that implements the Code cell in StickyLand.
 */
export class StickyCode implements IDisposable {
  stickyContent!: StickyContent;
  node!: HTMLElement;
  cellNode!: HTMLElement;
  editorNode!: HTMLElement | null;
  originalCell!: CodeCell;
  originalExecutionCounter!: HTMLElement | null;
  cell!: CodeCell;
  toggle!: Switch;
  renderer!: IRenderMime.IRenderer;
  notebook!: NotebookPanel;
  codemirror!: CodeMirror.Editor;
  private _executionCount!: number | null;
  executionCounter!: HTMLElement;
  codeObserver!: MutationObserver;
  autoRun = false;
  isDisposed = false;

  /**
   * Factory function for StickyCode when creating if from an existing cell
   * through dragging
   * @param stickyContent The sticky content that contains this markdown cell
   * @param cell The existing markdown cell
   * @param notebook The current notebook
   * @returns A new StickyCode object
   */
  static createFromExistingCell(
    stickyContent: StickyContent,
    cell: CodeCell,
    notebook: NotebookPanel
  ): StickyCode {
    const cd = new StickyCode();
    cd.stickyContent = stickyContent;
    cd.notebook = notebook;

    // Clone the cell
    cd.originalCell = cell;
    cd.cell = cd.originalCell.clone();

    // Register the original execution counter node
    cd.originalExecutionCounter = cd.originalCell.node.querySelector(
      '.jp-InputArea-prompt'
    );

    // Attach the clone node to stickyland
    cd.node = document.createElement('div');
    cd.node.classList.add('sticky-code');
    // Need to add tabindex so it can receive keyboard events
    cd.node.setAttribute('tabindex', '0');
    cd.stickyContent.contentNode.appendChild(cd.node);

    // Need to append the node to DOM first so we can do the cleaning
    cd.cellNode = cd.cell.node;
    cd.cellNode.classList.add('hidden');
    cd.node.appendChild(cd.cellNode);

    // Add a toolbar
    const toolbar = cd.createToolbar(cd.toolBarItems);
    cd.stickyContent.headerNode.appendChild(toolbar);

    // Bind the Codemirror
    const codeMirrorNode = cd.cell.node.querySelector('.CodeMirror') as unknown;
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    cd.codemirror = codeMirrorNode.CodeMirror as CodeMirror.Editor;

    // Wow, for some reason the clone somehow has a different codemirror config
    // from the original cell, need to reset it here
    // https://codemirror.net/doc/manual.html#setOption
    cd.codemirror.setOption('lineWrapping', false);
    console.log(cd.codemirror);

    cd.executionCount = cd.cell.model.executionCount;

    cd.cell.model.stateChanged.connect(cd.handleStateChange, cd);

    // Bind events
    // cd.bindEventHandlers();

    // Clean the unnecessary elements from the node clone
    cd.cleanCellClone();

    // Add a mutation observer so we can style the execution counter based on
    // the code focus
    cd.codeObserver = new MutationObserver(cd.codeClassMutationHandler);
    cd.editorNode = cd.cellNode.querySelector('.jp-CodeMirrorEditor');
    if (cd.editorNode) {
      cd.codeObserver.observe(cd.editorNode, { attributes: true });
    }

    console.log(notebook.model);

    return cd;
  }

  /**
   * We use a mutation observer to detect if user focuses on the code cell in
   * StickyLand. Remember to disconnect the observer in the dispose() method.
   * @param mutationList Array of mutation records
   * @param observer The observer itself
   */
  codeClassMutationHandler = (
    mutationList: MutationRecord[],
    observer: MutationObserver
  ) => {
    mutationList.forEach(d => {
      if (d.attributeName === 'class') {
        if (this.editorNode?.classList.contains('jp-mod-focused')) {
          this.executionCounter.classList.add('mod-focused');
        } else {
          this.executionCounter.classList.remove('mod-focused');
        }
      }
    });
  };

  /**
   * Helper function to handle code model state changes. The state change signal
   * is emitted with anything (input, output, etc.). This function follows the
   * signal pattern from lumino
   * (https://github.com/jupyterlab/extension-examples/tree/master/signals)
   * @param model CodeCellModel
   * @param args Arguments emitted from the model emitter, an example of the
   * signal structure is listed
   * [here](https://github.com/jupyterlab/jupyterlab/blob/5755ea86fef3fdbba10cd05b23703b9d60b53226/packages/cells/src/model.ts#L774)
   * The args is {name: str, oldValue: any, newValue: any}
   */
  handleStateChange = (
    model: ICellModel,
    args: IChangedArgs<any, any, string>
  ) => {
    const codeModel = model as ICodeCellModel;

    switch (args.name) {
      case 'executionCount':
        // Update the execution count
        this.executionCount = codeModel.executionCount;
        break;
      case 'isDirty':
        // Color the execution based on the dirty state
        if (args.newValue) {
          this.executionCounter.classList.add('dirty');
        } else {
          this.executionCounter.classList.remove('dirty');
        }
        break;
      default:
        break;
    }

    // A hack to know if user executes the code (the "correct" way would be to
    // listen to the notebookAction's execution signal)
    // Here we just quickly query if the prompt has become '[*]'
    // console.log(this.originalExecutionCounter?.innerHTML);
    // if (this.originalExecutionCounter?.innerHTML === '[*]:') {
    //   // Set the counter to star
    //   console.log('to star');
    //   this.executionCounter.innerText = '[*]';
    // }

    console.log(model, args);

    console.log(this.executionCount);
  };

  /**
   * Setter function for the executionCount. It also updates the count element
   */
  set executionCount(newCount: number | null) {
    this._executionCount = newCount;

    // Update the counter element
    if (newCount !== null) {
      this.executionCounter.innerText = `[${newCount}]`;
    } else {
      this.executionCounter.innerText = '[*]';
    }
  }

  /**
   * Getter function for the executionCount.
   */
  get executionCount() {
    return this._executionCount;
  }

  /**
   * Factory function for StickyCode when creating if from a new markdown
   * cell. This function would append a new markdown cell to the main notebook.
   * @param stickyContent The sticky content that contains this markdown cell
   * @param notebook The current notebook
   * @returns A new StickyCode object
   */
  static createFromNewCell(
    stickyContent: StickyContent,
    notebook: NotebookPanel
  ): StickyCode {
    // Append a new markdown cell to the main notebook
    NotebookActions.insertBelow(notebook.content);
    NotebookActions.changeCellType(notebook.content, 'code');

    const newCell = notebook.content.activeCell as CodeCell;

    // Activate the original active cell
    notebook.content.activeCellIndex = notebook.content.activeCellIndex - 1;

    // Construct StickyCode using the new cell as an existing cell
    return this.createFromExistingCell(stickyContent, newCell, notebook);
  }

  /**
   * Strip unnecessary elements from the nodes before appending it to stickyland
   */
  cleanCellClone = () => {
    // Remove the left region (prompt and collapser), header and footer
    this.cellNode.querySelector('.jp-Cell-inputCollapser')?.remove();
    this.cellNode.querySelector('.jp-OutputCollapser')?.remove();
    this.cellNode.querySelector('.jp-InputArea-prompt')?.remove();
    this.cellNode.querySelector('.jp-OutputArea-prompt')?.remove();
    this.cellNode.querySelector('.jp-CellHeader')?.remove();
    this.cellNode.querySelector('.jp-CellFooter')?.remove();

    // Add class name to the rendered region
    this.cellNode
      .querySelector('.jp-OutputArea')
      ?.classList.add('sticky-code-output');
    this.cellNode.classList.add('sticky-code-cell');

    this.cellNode.classList.remove('hidden');
  };

  /**
   * Bind event handlers for sticky markdown cell.
   */
  bindEventHandlers = () => {
    // Double click the rendered view should trigger editor
    this.node.addEventListener('dblclick', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    });

    // Click on the rendered view should focus the current element
    this.node.addEventListener('click', (e: MouseEvent) => {
      // if (this.cell.rendered) {
      //   this.node.focus();
      // }
    });

    // Bind keyboard short cuts
    this.node.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (e.shiftKey || e.ctrlKey) {
          // [Shift + enter] or [control + enter] render the markdown cell
          e.preventDefault();
          e.stopPropagation();
        } else {
          // [Enter] in rendered mode triggers the editor
        }
      }
    });
  };

  /**
   * Create a toolbar element
   * @param items List of toolbar item names and onclick handlers
   */
  createToolbar = (
    items: {
      name: string;
      title: string;
      icon: LabIcon;
      onClick: (e: Event) => any;
    }[]
  ): HTMLElement => {
    const toolbar = document.createElement('div');
    toolbar.classList.add(
      'sticky-toolbar',
      'jp-Toolbar',
      'sticky-code-toolbar'
    );

    const buttonGroup = document.createElement('div');
    buttonGroup.classList.add('toolbar-buttons');

    const statusGroup = document.createElement('div');
    statusGroup.classList.add('toolbar-status');

    toolbar.appendChild(buttonGroup);
    toolbar.appendChild(statusGroup);

    // Add buttons into the toolbar
    items.forEach(d => {
      const item = document.createElement('div');
      item.classList.add('jp-ToolbarButton', 'jp-Toolbar-item');
      buttonGroup.appendChild(item);

      const itemElem = document.createElement('button');
      itemElem.classList.add(
        'jp-ToolbarButtonComponent',
        'button',
        'jp-Button',
        'toolbar-button',
        'bp3-button',
        'bp3-minimal',
        `button-${d.name}`
      );
      itemElem.setAttribute('title', d.title);
      itemElem.addEventListener('click', d.onClick);
      item.appendChild(itemElem);

      // Add icon to the button
      const iconSpan = document.createElement('span');
      iconSpan.classList.add('jp-ToolbarButtonComponent-icon');
      itemElem.appendChild(iconSpan);

      d.icon.element({
        container: iconSpan
      });
    });

    // Add a toggle switch into the toolbar
    this.toggle = new Switch();

    this.toggle.valueChanged.connect((_, args) => {
      this.autoRun = args.newValue;
    });
    this.toggle.value = this.autoRun;
    this.toggle.label = 'auto-run';

    // Here we are not correctly attach the widget to a layout, so we need to
    // manually trigger the event binding
    const toggleSwitchNode = this.toggle.node.querySelector('.jp-switch');
    toggleSwitchNode?.addEventListener('click', this.toggle);

    statusGroup.appendChild(this.toggle.node);

    // Add an execution counter into the toolbar
    this.executionCounter = document.createElement('div');
    this.executionCounter.classList.add('execution-counter');
    statusGroup.appendChild(this.executionCounter);

    return toolbar;
  };

  editClicked = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();

    // Show the editing area
  };

  runClicked = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();

    // Render the markdown
  };

  launchClicked = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();

    console.log(this.cell.editor.getCursorPosition());

    console.log('Launch clicked!');
  };

  closeClicked = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();

    console.log('Close clicked!');
  };

  toolBarItems = [
    {
      name: 'run',
      title: 'Run the cell',
      icon: runIcon,
      onClick: this.runClicked
    },
    {
      name: 'launch',
      title: 'Make the cell float',
      icon: launcherIcon,
      onClick: this.launchClicked
    },
    {
      name: 'close',
      title: 'Remove the cell',
      icon: closeIcon,
      onClick: this.closeClicked
    }
  ];

  dispose() {
    this.node.remove();
    this.codeObserver.disconnect();
    this.toggle.dispose();
    this.isDisposed = true;
  }
}
