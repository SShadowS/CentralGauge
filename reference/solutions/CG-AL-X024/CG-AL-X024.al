table 71130 "CG X024 Token"
{
    Access = Internal;
    DataClassification = SystemMetadata;

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
        }
        field(2; "External Ref"; Text[50])
        {
            Caption = 'External Ref';
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
    }
}

codeunit 71131 "CG X024 Registrar"
{
    Access = Internal;

    procedure Register(EntryNo: Integer; Ref: Text)
    var
        Token: Record "CG X024 Token";
    begin
        if Token.Get(EntryNo) then begin
            Token."External Ref" := CopyStr(Ref, 1, MaxStrLen(Token."External Ref"));
            Token.Modify();
        end else begin
            Token.Init();
            Token."Entry No." := EntryNo;
            Token."External Ref" := CopyStr(Ref, 1, MaxStrLen(Token."External Ref"));
            Token.Insert();
        end;
    end;

    procedure GetRef(EntryNo: Integer): Text
    var
        Token: Record "CG X024 Token";
    begin
        if Token.Get(EntryNo) then
            exit(Token."External Ref");

        exit('');
    end;
}