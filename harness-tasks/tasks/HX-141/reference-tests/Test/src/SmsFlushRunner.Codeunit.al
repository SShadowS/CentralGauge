codeunit 80493 "CGR SMS Flush Runner"
{
    var
        FlushedInRun: Integer;

    trigger OnRun()
    var
        CheckoutSms: Codeunit "CGR Checkout SMS";
    begin
        FlushedInRun := CheckoutSms.Flush();
    end;

    procedure FlushedCount(): Integer
    begin
        exit(FlushedInRun);
    end;
}
