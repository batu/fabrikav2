I’ll run this as a report-only bug hunt. I’m using the code-review skill because the request is a structured regression audit; I’ll also check the relevant prior editor-error memory, then trace mappings and callers across `tools/level-editor/ui/src`.

The review workflow explicitly requires parallel reviewers, so I’m splitting the audit into independent lanes: status/copy mapping, suppressed or swallowed failures, and promise verification. I’ll synthesize and deduplicate their evidence into the requested numbered report.

The central defect pattern is already clear: `apiErrorHint` receives only an `ApiError`, not the initiating UI action, so global status/substr rules routinely overstate intent and recovery. I’m now checking whether each suppressed request truly owns an inline surface and whether the recovery claims are backed by a retry/reconciliation path.

1. **P1 — [`api/editorApi.ts:80`](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/api/editorApi.ts:80)**  
   Wrong/unverifiable: “The level changed while this save was pending. Refresh the level and retry; supported editor saves retry automatically.”  
   This applies to every unsuppressed revision-related 409, including final approval, which deliberately does not retry automatically. Only cutout placement has a one-time revision retry, and that caller suppresses the global toast.  
   Honest: “The level changed on the server. Re-check the current level, then repeat this action if it is still appropriate.”

2. **P1 — [`api/editorApi.ts:92`](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/api/editorApi.ts:92)**  
   Wrong/unverifiable: “The server did not answer in time (proxy timeout or restart). The action likely did not complete — retry it once.”  
   A 502 does not establish timeout, restart, or non-completion. This is the message shown for archive PATCH failures; blindly repeating other mutations may duplicate work that already completed upstream.  
   Honest: “The server returned a gateway error, so this action’s outcome is unknown. Refresh the current state before deciding whether to retry.”

3. **P1 — [`api/editorApi.ts:91`](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/api/editorApi.ts:91)**  
   Wrong/unverifiable: “The generation service failed upstream. Retry Extract or Regenerate for the affected bird; existing cutouts were preserved.”  
   URL substring matching classifies all `inpaint`, `retry`, `generate`, and `extract` URLs as per-bird generation. That includes the non-generation `/cutout-extraction-prompt` GET and whole-level inpaint jobs. A 502 cannot prove that existing cutouts were preserved or even whether a durable job was accepted.  
   Honest: “The generation request hit a gateway error. Its completion state is unknown; refresh the job or session status before retrying.”

4. **P2 — [`api/editorApi.ts:85`](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/api/editorApi.ts:85)**  
   Wrong premise driving the 502 copy: “502 means the request never completed.”  
   Honest internal rule: “A 502 indicates a gateway or upstream failure; completion is unknown without action-specific readback or idempotency.”

5. **P2 — [`api/editorApi.ts:81`](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/api/editorApi.ts:81)**  
   Wrong mapping: any error containing `padding` receives “Select Padding for the named bird, then drag the yellow box…”  
   Numeric validation errors such as “padding must be in [1.0, 5.0]” have no named bird or yellow box to repair.  
   Honest: “Set the padding value within the allowed range shown above, then try again.” Cross-bird geometry guidance should require a typed error code.

6. **P2 — [`api/editorApi.ts:95`](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/api/editorApi.ts:95)**  
   Wrong/unverifiable: “Refresh the level and use the prerequisite named above.”  
   This blanket 409 mapping implies refresh is corrective. For prerequisites such as `hitboxes_not_blessed`, refreshing cannot bless hitboxes.  
   Honest: “This action conflicts with the current state. Follow the requirement in the error above; reload only if the displayed state appears stale.”

7. **P1 — [`components/StepInpaint.tsx:284`](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/StepInpaint.tsx:284)**  
   Silent failure: retry-job polling logs only to the console. `getRetryFailedDogsJob()` suppresses the toast, so the user sees nothing and the button merely becomes enabled again.  
   Honest: “Could not confirm whether the retry job finished. It may still be running; refresh the job status.”

8. **P1 — [`components/SequencePage.tsx:454`](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/SequencePage.tsx:454)**  
   Silent/destructive recovery: failure to restore a saved start-job status shows nothing and deletes the stored job ID. `getJob()` suppresses its toast, so a transient network failure permanently loses the resume pointer.  
   Honest: “Could not restore the lineup job status. The saved job ID was kept; retry refresh.” Delete it only after a confirmed invalid/not-found response.

9. **P2 — [`components/StepPlaceDogs.tsx:170`](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/StepPlaceDogs.tsx:170)**  
   Silent false-clean state: a suppressed mobile-visibility failure becomes `[]`, indistinguishable from “no visibility issues.”  
   Honest: “Mobile visibility check unavailable; placement safety is not verified.”

10. **P2 — [`components/GalleryReviewModal.tsx:521`](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/GalleryReviewModal.tsx:521)**  
    Silent false-clean state: the same suppressed visibility failure clears all issues.  
    Honest: “Visibility check unavailable — no clean result was obtained.” Preserve the prior report or represent the result as unknown.

11. **P2 — [`components/GalleryPage.tsx:252`](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/GalleryPage.tsx:252)**  
    Silent false-clean state: batch visibility failure clears the report map. Missing warning badges can then be mistaken for passing cards.  
    Honest: “Mobile visibility checks are unavailable; missing badges do not indicate a pass.”

12. **P2 — [`components/CutoutReviewPanel.tsx:456`](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/CutoutReviewPanel.tsx:456)**  
    Swallowed into an empty string: suppressed extraction-prompt failure calls `setExtractionPrompt('')`, making “failed to load” indistinguishable from “no prompt.”  
    Honest: “Extraction prompt could not be loaded.” If extraction can safely use a server default, say that explicitly; otherwise disable it pending retry.

13. **P2 — [`components/PromptSaver.tsx:92`](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/PromptSaver.tsx:92)**  
    Silent save failure: the raw-fetch catch writes only to the console. There is no shared toast or inline error, and the button simply stops showing “Saving.”  
    Honest: “Prompt was not saved. Your text is still here; retry Save.”

14. **P2 — [`App.tsx:165`](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/App.tsx:165)**  
    Silent restore failure: `getGenerationStatus()` suppresses its toast and the caller catches with console output only. An active background job may therefore fail to reconnect with no explanation.  
    Honest: “Could not restore background-generation status. The job may still be running; retry status.”

15. **P3 — [`components/PromptSaver.tsx:61`](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/PromptSaver.tsx:61)**  
    Swallowed load failure: the saved server prompt fails silently and the local/static default remains displayed as though authoritative.  
    Honest: “Saved prompt unavailable; showing the local default.”

16. **P3 — [`components/DevicePreview.tsx:102`](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/DevicePreview.tsx:102)**  
    Swallowed configuration failure: non-OK and network failures become `null`; the device preview continues without disclosing that geometry configuration is unavailable.  
    Honest: “Device geometry config unavailable; preview is using fallback geometry.” If no deliberate fallback contract exists, mark the preview unavailable instead.

No files were changed. Three parallel audit lanes covered mapping scope, suppressed/swallowed failures, and behavioral promises.

