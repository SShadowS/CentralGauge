table 70391 "CG X074 Comment Line"
{
    Caption = 'Expense Report Comment Line';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Expense Report No."; Code[20])
        {
            Caption = 'Expense Report No.';
            DataClassification = CustomerContent;
        }
        field(2; "Line No."; Integer)
        {
            Caption = 'Line No.';
            DataClassification = CustomerContent;
        }
        field(3; "Comment Text"; Text[250])
        {
            Caption = 'Comment';
            DataClassification = CustomerContent;
        }
        field(4; "Created By"; Code[50])
        {
            Caption = 'Created By';
            DataClassification = CustomerContent;
        }
        field(5; "Created At"; DateTime)
        {
            Caption = 'Created At';
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "Expense Report No.", "Line No.")
        {
            Clustered = true;
        }
    }
}
