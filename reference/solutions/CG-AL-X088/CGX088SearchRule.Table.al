table 70530 "CG X088 Search Rule"
{
    Caption = 'Search Rule';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
            AutoIncrement = true;
        }
        field(2; "Rule Name"; Text[100])
        {
            Caption = 'Rule Name';
        }
        field(3; "Search Field"; Text[50])
        {
            Caption = 'Search Field';
        }
        field(4; Completed; Boolean)
        {
            Caption = 'Completed';
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
