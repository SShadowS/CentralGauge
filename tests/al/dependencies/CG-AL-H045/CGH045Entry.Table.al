table 69450 "CG H045 Entry"
{
    Caption = 'CG H045 Entry';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
        }
        field(10; "Doc No."; Code[20])
        {
            Caption = 'Doc No.';
        }
        field(20; "Tolerance"; Decimal)
        {
            Caption = 'Tolerance';
        }
        field(30; "Accepted Flag"; Boolean)
        {
            Caption = 'Accepted Flag';
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
