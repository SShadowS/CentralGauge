table 70721 "CG X112 Status Entry"
{
    DataClassification = CustomerContent;
    Caption = 'CG X112 Status Entry';

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
            AutoIncrement = true;
        }
        field(2; "Agreement No."; Code[20])
        {
            Caption = 'Agreement No.';
        }
        field(3; "Entry Date"; Date)
        {
            Caption = 'Entry Date';
        }
        field(4; Severity; Option)
        {
            Caption = 'Severity';
            OptionMembers = Info,Warning,Error;
            OptionCaption = 'Info,Warning,Error';
        }
        field(5; Resolved; Boolean)
        {
            Caption = 'Resolved';
        }
        field(6; Message; Text[100])
        {
            Caption = 'Message';
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
        key(Agreement; "Agreement No.", "Entry No.")
        {
        }
    }
}
