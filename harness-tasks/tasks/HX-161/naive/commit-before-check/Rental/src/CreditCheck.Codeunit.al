codeunit 70291 "CGR Credit Check"
{
    procedure CheckCustomer(CustomerName: Text[100]): Boolean
    var
        CheckRun: Codeunit "CGR Credit Check Run";
    begin
        CheckRun.SetCustomer(CustomerName);
        if not CheckRun.Run() then
            exit(false);
        exit(CheckRun.Approved());
    end;
}
