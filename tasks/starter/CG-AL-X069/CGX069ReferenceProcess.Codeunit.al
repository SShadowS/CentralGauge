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
        DocumentDate: Date;
    begin
        QueueEntry.SetFilter("Report Type", '%1|%2', QueueEntry."Report Type"::Annual, QueueEntry."Report Type"::Quarterly);
        if QueueEntry.FindSet() then
            repeat
                DocumentDate := GetDocumentDate(QueueEntry."Source Record Id");
                if (DocumentDate <> 0D) and (DocumentDate <= PeriodEndingDate) then
                    exit(true);
            until QueueEntry.Next() = 0;
        exit(false);
    end;

    local procedure GetDocumentDate(SourceRecordId: Guid): Date
    var
        RecRef: RecordRef;
        FldRef: FieldRef;
        DocumentDate: Date;
    begin
        RecRef.Open(Database::"CG X069 Report Source");
        if not RecRef.GetBySystemId(SourceRecordId) then
            exit(0D);
        FldRef := RecRef.Field(3);
        DocumentDate := FldRef.Value;
        exit(DocumentDate);
    end;
}
