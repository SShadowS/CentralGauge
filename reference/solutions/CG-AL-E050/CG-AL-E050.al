codeunit 70050 "CG Text Builder"
{
    Access = Public;

    procedure GetSqlQuery(): Text
    begin
        exit(@'SELECT CustomerNo, Name, Balance
FROM Customer
WHERE Active = true
ORDER BY Name');
    end;

    procedure GetJsonTemplate(): Text
    begin
        exit(@'{
  "type": "invoice",
  "version": "1.0",
  "data": null
}');
    end;

    procedure GetEmailBody(CustomerName: Text): Text
    var
        EmailTemplate: Text;
    begin
        EmailTemplate := @'Dear [CustomerName],

Thank you for your order.

Best regards,
Sales Team';

        exit(EmailTemplate.Replace('[CustomerName]', CustomerName));
    end;
}