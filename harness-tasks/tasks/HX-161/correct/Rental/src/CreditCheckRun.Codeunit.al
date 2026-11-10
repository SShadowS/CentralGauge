codeunit 70292 "CGR Credit Check Run"
{
    var
        Customer: Text[100];
        IsApproved: Boolean;

    procedure SetCustomer(CustomerName: Text[100])
    begin
        Customer := CustomerName;
    end;

    procedure Approved(): Boolean
    begin
        exit(IsApproved);
    end;

    procedure Check()
    begin
        IsApproved := false;
        OnCheckCredit(Customer, IsApproved);             // credit agency app; may raise an error
    end;

    trigger OnRun()
    begin
        Check();
    end;

    [IntegrationEvent(false, false)]
    local procedure OnCheckCredit(CustomerName: Text[100]; var Approved: Boolean)
    begin
    end;
}
