codeunit 70470 "CGR Outbox Redelivery"
{
    procedure IsDue(EntryNo: Integer; Now: DateTime): Boolean
    var
        Entry: Record "CGR Outbox Entry";
    begin
        if not Entry.Get(EntryNo) then
            exit(false);
        if Entry.Sent or Entry.Failed then
            exit(false);
        if Entry."Last Attempt At" = 0DT then
            exit(true);
        exit(Now - Entry."Last Attempt At" >= RetryDelayMs());
    end;

    procedure RetryDue(Now: DateTime) Sent: Integer
    var
        Entry: Record "CGR Outbox Entry";
        SendUnit: Codeunit "CGR Redelivery Send";
        Candidates: List of [Integer];
        EntryNo: Integer;
    begin
        Entry.SetRange(Sent, false);
        Entry.SetRange(Failed, false);
        if Entry.FindSet() then
            repeat
                if IsDue(Entry."Entry No.", Now) then
                    Candidates.Add(Entry."Entry No.");
            until Entry.Next() = 0;
        foreach EntryNo in Candidates do begin
            Commit();
            Entry.Get(EntryNo);
            Clear(SendUnit);
            if SendUnit.Run(Entry) then begin
                Entry.Get(EntryNo);
                Entry.Sent := true;
                Entry.Modify();
                Sent += 1;
            end else begin
                Entry.Get(EntryNo);
                Entry.Attempts += 1;
                Entry."Last Attempt At" := Now;
                Entry.Failed := Entry.Attempts >= 5;
                Entry.Modify();
            end;
        end;
        Commit();
    end;

    local procedure RetryDelayMs(): Integer
    begin
        exit(29000);
    end;
}
