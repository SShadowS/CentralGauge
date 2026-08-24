codeunit 70342 "CG X069 Reference Process"
{
    procedure EnqueueReference(var Source: Record "CG X069 Report Source")
    var
        QueueEntry: Record "CG X069 Queue Entry";
    begin
        QueueEntry.Init();
        QueueEntry."Report Type" := Source."Report Type";
        QueueEntry."Source Record Id" := Source.SystemId;
        QueueEntry."Queued At" := CurrentDateTime;
        QueueEntry."Reference Date" := Source."Posting Date";
        QueueEntry.Insert(true);
    end;

    procedure RemoveReference(EntryNo: Integer)
    var
        QueueEntry: Record "CG X069 Queue Entry";
    begin
        if QueueEntry.Get(EntryNo) then
            QueueEntry.Delete();
    end;

    procedure HasPendingReferenceUpToPeriodEnd(PeriodEndingDate: Date): Boolean
    var
        QueueEntry: Record "CG X069 Queue Entry";
    begin
        QueueEntry.SetCurrentKey("Report Type", "Reference Date");
        QueueEntry.SetFilter("Report Type", '%1|%2', QueueEntry."Report Type"::Annual, QueueEntry."Report Type"::Quarterly);
        QueueEntry.SetFilter("Reference Date", '>%1&<=%2', 0D, PeriodEndingDate);
        exit(not QueueEntry.IsEmpty());
    end;
}
