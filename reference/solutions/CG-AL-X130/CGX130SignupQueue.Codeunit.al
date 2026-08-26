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
    var
        Index: Integer;
    begin
        for Index := PendingIds.Count downto 1 do
            PendingIds.RemoveAt(Index);
    end;
}
