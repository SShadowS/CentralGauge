table 71140 "CG X025 Doc"
{
    Access = Internal;
    DataClassification = SystemMetadata;

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
        }
        field(2; Name; Text[50])
        {
            Caption = 'Name';
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
    }

    trigger OnInsert()
    var
        CGX025DocLog: Record "CG X025 Doc Log";
    begin
        if Rec.IsTemporary() then
            exit;

        CGX025DocLog.Init();
        CGX025DocLog."Doc Entry No." := Rec."Entry No.";
        CGX025DocLog.Insert(true);
    end;
}

table 71141 "CG X025 Doc Log"
{
    DataClassification = SystemMetadata;

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
            AutoIncrement = true;
        }
        field(2; "Doc Entry No."; Integer)
        {
            Caption = 'Doc Entry No.';
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