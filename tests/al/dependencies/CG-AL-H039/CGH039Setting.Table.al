table 69390 "CG H039 Setting"
{
    Caption = 'CG H039 Setting';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Code"; Code[20])
        {
            Caption = 'Code';
            NotBlank = true;
        }
        field(10; "Value"; Text[50])
        {
            Caption = 'Value';
        }
    }

    keys
    {
        key(PK; "Code")
        {
            Clustered = true;
        }
    }
}
