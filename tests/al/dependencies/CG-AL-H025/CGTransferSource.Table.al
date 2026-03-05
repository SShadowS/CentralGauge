table 69040 "CG Transfer Source"
{
    Caption = 'CG Transfer Source';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Code"; Code[20])
        {
            Caption = 'Code';
            NotBlank = true;
        }
        field(2; "Description"; Text[100])
        {
            Caption = 'Description';
        }
        field(3; "Amount"; Decimal)
        {
            Caption = 'Amount';
        }
        field(4; "Category"; Code[20])
        {
            Caption = 'Category';
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
