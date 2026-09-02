codeunit 71472 "CG X163 Ledger Mgt"
{
    procedure SetAmount(ForCompany: Text[30]; AccountCode: Code[20]; NewAmount: Decimal)
    var
        Ledger: Record "CG X163 Branch Ledger";
        Found: Boolean;
    begin
        Ledger.ChangeCompany(ForCompany);
        Found := Ledger.Get(AccountCode);
        if not Found then begin
            Ledger.Init();
            Ledger."Account Code" := AccountCode;
        end;
        Ledger.Amount := NewAmount;
        if Found then
            Ledger.Modify()
        else
            Ledger.Insert();
    end;

    procedure GetAmountDirect(ForCompany: Text[30]; AccountCode: Code[20]): Decimal
    var
        Ledger: Record "CG X163 Branch Ledger";
    begin
        Ledger.ChangeCompany(ForCompany);
        if Ledger.Get(AccountCode) then
            exit(Ledger.Amount);
        exit(0);
    end;
}
