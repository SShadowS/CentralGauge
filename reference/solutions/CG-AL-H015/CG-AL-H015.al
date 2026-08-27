interface "Payment Gateway"
{
    procedure Authorize(Amount: Decimal): Boolean;
    procedure GetGatewayName(): Text;
}

codeunit 70215 "PayPal Provider" implements "Payment Gateway"
{
    procedure Authorize(Amount: Decimal): Boolean
    begin
        exit(Amount < 1000);
    end;

    procedure GetGatewayName(): Text
    begin
        exit('PayPal');
    end;
}

codeunit 70216 "Credit Card Provider" implements "Payment Gateway"
{
    procedure Authorize(Amount: Decimal): Boolean
    begin
        exit(true);
    end;

    procedure GetGatewayName(): Text
    begin
        exit('Credit Card');
    end;
}

codeunit 70217 "Payment Service"
{
    procedure Process(Gateway: Interface "Payment Gateway"; Amount: Decimal): Text
    begin
        if Gateway.Authorize(Amount) then
            exit('Authorized by ' + Gateway.GetGatewayName());

        exit('Declined by ' + Gateway.GetGatewayName());
    end;
}