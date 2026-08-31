codeunit 70901 "CG X130 Signup Queue"
{
    var
        PendingIds: List of [Code[20]];

    procedure QueueSignup(CustomerNo: Code[20])
    begin
        PendingIds.Add(CustomerNo);
    end;

    procedure PendingSignups(): List of [Code[20]]
    begin
        exit(PendingIds);
    end;

    procedure StartNewDay()
    begin
        Clear(PendingIds);
    end;
}
