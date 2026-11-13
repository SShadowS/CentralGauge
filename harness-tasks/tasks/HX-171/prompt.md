# Bug 5171: The collection preview lists installments that were invoiced already

Reported by Collections.

Before each invoicing run, collections works through the collection preview of the leases they look after: `CGR Collection Preview`.`BuildCollectionPreview(var Contract: Record "CGR Lease Contract"; UpToDate: Date; var Preview: Record "CGR Collection Preview Line" temporary)` in the Reporting app. Since the last release the preview also lists schedule lines that the previous invoicing run invoiced, so collectors chase customers for installments they have already been billed for.

Expected: for every lease in the caller's selection, the preview lists each schedule line of the lease that is due on or before UpToDate and not invoiced yet, with its due date and amount; a lease with nothing due has no line in the preview. Partner apps subscribe to `OnAfterCollectionLineAdded` of `CGR Collection Line Check`, which is raised for each line once that line is in the preview buffer, so a partner can read or adjust the line there; a partner may refuse the lease by raising an error. Each lease is checked on its own: a lease that a partner refuses, or whose check fails, leaves none of its schedule lines in the preview, only its error line (Line No. 0, with the error text), and the leases that pass keep their lines.
