table 70382 "CG X073 Category Report Filter"
{
    Caption = 'Category Report Filter';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Filter Code"; Code[20])
        {
            Caption = 'Filter Code';
            DataClassification = CustomerContent;
        }
        field(2; "Filter Description"; Text[100])
        {
            Caption = 'Filter Description';
            DataClassification = CustomerContent;
        }
        field(3; "Category Code"; Code[20])
        {
            Caption = 'Category Code';
            DataClassification = CustomerContent;
        }
        field(4; Enabled; Boolean)
        {
            Caption = 'Enabled';
            DataClassification = CustomerContent;
            InitValue = true;
        }
    }

    keys
    {
        key(PK; "Filter Code")
        {
            Clustered = true;
        }
        key(Category; "Category Code")
        {
        }
    }
}
