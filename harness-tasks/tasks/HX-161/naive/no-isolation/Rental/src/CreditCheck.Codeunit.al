codeunit 70291 "CGR Credit Check"
{
    procedure CheckCustomer(CustomerName: Text[100]): Boolean
    var
        CheckRun: Codeunit "CGR Credit Check Run";
    begin
        CheckRun.SetCustomer(CustomerName);
        CheckRun.Check();
        exit(CheckRun.Approved());
    end;
}
