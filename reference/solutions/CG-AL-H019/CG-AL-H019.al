codeunit 70019 "CG Internal Service"
{
    Access = Public;
    InherentEntitlements = X;
    InherentPermissions = X;

    [NonDebuggable]
    procedure ProcessSensitiveData(InputData: Text): Text
    begin
        exit('Processed: ' + InputData);
    end;

    procedure GetPublicData(): Text
    begin
        exit('Public Data Available');
    end;

    [TryFunction]
    procedure TryProcessData()
    var
        Result: Text;
    begin
        Result := InternalHelper();
        if Result = '' then
            Error('Processing failed.');
    end;

    local procedure InternalHelper(): Text
    begin
        exit('Helper Result');
    end;
}