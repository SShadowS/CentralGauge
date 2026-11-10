codeunit 70291 "CGR Credit Check"
{
    procedure CheckCustomer(CustomerName: Text[100]): Boolean
    var
        CheckRun: Codeunit "CGR Credit Check Run";
    begin
        CheckRun.SetCustomer(CustomerName);
        if TryCheck(CheckRun) then;
        exit(CheckRun.Approved());
    end;

    [TryFunction]
    local procedure TryCheck(var CheckRun: Codeunit "CGR Credit Check Run")
    begin
        CheckRun.Check();
    end;
}
