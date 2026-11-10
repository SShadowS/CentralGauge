codeunit 70291 "CGR Credit Check"
{
    procedure CheckCustomer(CustomerName: Text[100]): Boolean
    var
        Approved: Boolean;
    begin
        if not TryCheck(CustomerName, Approved) then
            exit(false);
        exit(Approved);
    end;

    [TryFunction]
    local procedure TryCheck(CustomerName: Text[100]; var Approved: Boolean)
    var
        CheckRun: Codeunit "CGR Credit Check Run";
    begin
        CheckRun.SetCustomer(CustomerName);
        CheckRun.Check();
        Approved := CheckRun.Approved();
    end;
}
