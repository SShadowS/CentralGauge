codeunit 80467 "CGR Purge Naive Basic Runner"
{
    var
        BasicOlderThan: DateTime;
        BasicDeleted: Integer;

    trigger OnRun()
    var
        OutboxPurge: Codeunit "CGR Outbox Purge";
    begin
        BasicDeleted := OutboxPurge.PurgeSent(BasicOlderThan);
    end;

    procedure SetBasicRun(OlderThan: DateTime)
    begin
        BasicOlderThan := OlderThan;
    end;

    procedure BasicDeletedCount(): Integer
    begin
        exit(BasicDeleted);
    end;
}
