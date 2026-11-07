codeunit 80462 "CGR Outbox Purge Runner"
{
    var
        RunOlderThan: DateTime;
        DeletedInRun: Integer;

    trigger OnRun()
    var
        OutboxPurge: Codeunit "CGR Outbox Purge";
    begin
        DeletedInRun := OutboxPurge.PurgeSent(RunOlderThan);
    end;

    procedure SetPurgeRun(OlderThan: DateTime)
    begin
        RunOlderThan := OlderThan;
    end;

    procedure DeletedInPurgeRun(): Integer
    begin
        exit(DeletedInRun);
    end;
}
