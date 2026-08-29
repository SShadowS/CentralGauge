codeunit 71482 "CG X164 Request Mgt"
{
    procedure SubmitRequest(No: Code[20]; RequestDescription: Text[100]; Amount: Decimal)
    var
        Request: Record "CG X164 Request";
        Trace: Record "CG X164 Usage Trace";
    begin
        if Amount <= 0 then
            Error('The request amount must be greater than zero.');

        Request.Init();
        Request."No." := No;
        Request.Description := RequestDescription;
        Request.Amount := Amount;
        Request.Insert(true);

        if Trace.WritePermission() then begin
            Trace.Init();
            Trace."Request No." := No;
            Trace.Description := RequestDescription;
            Trace.Insert(true);
        end;
    end;

    procedure CountTraces(No: Code[20]): Integer
    var
        Trace: Record "CG X164 Usage Trace";
    begin
        Trace.SetRange("Request No.", No);
        exit(Trace.Count());
    end;
}
